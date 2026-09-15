import json
import os
import sys
from pathlib import Path

import requests
from google import genai


# ============================================================
# CONFIG
# ============================================================

DEVTO_API = "https://dev.to/api"
DEVTO_ARTICLES = f"{DEVTO_API}/articles"

MODEL = "gemini-3.8-flash"

HISTORY_FILE = Path("data/topic_history.json")

MAX_TRENDING_ARTICLES = 30
MAX_HISTORY = 100


# ============================================================
# ENVIRONMENT
# ============================================================

DEVTO_API_KEY = os.getenv("DEVTO_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")


if not DEVTO_API_KEY:
    print("ERROR: DEVTO_API_KEY is missing")
    sys.exit(1)

if not GEMINI_API_KEY:
    print("ERROR: GEMINI_API_KEY is missing")
    sys.exit(1)


# ============================================================
# GEMINI
# ============================================================

client = genai.Client(
    api_key=GEMINI_API_KEY
)


# ============================================================
# TOPIC HISTORY
# ============================================================

def load_history():

    if not HISTORY_FILE.exists():
        return []

    try:
        with open(HISTORY_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        if isinstance(data, list):
            return data

        print("Topic history is not a JSON array. Starting fresh.")
        return []

    except (json.JSONDecodeError, OSError) as e:
        print(f"Could not read topic history: {e}")
        print("Starting with empty topic history.")
        return []


def save_history(history):

    HISTORY_FILE.parent.mkdir(
        parents=True,
        exist_ok=True
    )

    history = history[-MAX_HISTORY:]

    with open(
        HISTORY_FILE,
        "w",
        encoding="utf-8"
    ) as f:

        json.dump(
            history,
            f,
            indent=2,
            ensure_ascii=False
        )


# ============================================================
# DEV.TO
# ============================================================

def get_trending_articles():

    print("Fetching DEV.to rising articles...")

    response = requests.get(
        DEVTO_ARTICLES,
        params={
            "state": "rising",
            "per_page": MAX_TRENDING_ARTICLES
        },
        headers={
            "api-key": DEVTO_API_KEY
        },
        timeout=30
    )

    response.raise_for_status()

    articles = response.json()

    print(
        f"Found {len(articles)} rising DEV.to articles."
    )

    return articles


# ============================================================
# PREPARE TREND DATA
# ============================================================

def prepare_topics(articles):

    topics = []

    for article in articles:

        topics.append({
            "title": article.get("title"),
            "description": article.get("description"),
            "tags": article.get("tag_list", []),
            "reactions": article.get(
                "positive_reactions_count",
                0
            ),
            "comments": article.get(
                "comments_count",
                0
            ),
            "published_at": article.get(
                "published_at"
            ),
        })

    return topics


# ============================================================
# AI GENERATION
# ============================================================

def generate_article(topics, history):

    topic_text = json.dumps(
        topics,
        indent=2,
        ensure_ascii=False
    )

    history_text = json.dumps(
        history[-30:],
        indent=2,
        ensure_ascii=False
    )

    prompt = f"""
You are an experienced Staff Software Engineer and
technical writer creating an original article for DEV.to.

Your expertise includes:

- React
- JavaScript
- TypeScript
- Frontend architecture
- Micro Frontends
- Module Federation
- System Design
- Distributed Systems
- Go
- AI
- LLMs
- AI Agents
- Developer Productivity
- Software Architecture

Your job is to analyze CURRENT DEV.to rising articles and
identify a strong topic/theme.

Then create an ORIGINAL article around that theme.

IMPORTANT:

Do NOT copy or closely rewrite any existing DEV.to article.

Do NOT reuse their:

- title
- wording
- structure
- examples
- code
- conclusions

Instead, identify the underlying trend and create a
different, substantially more useful engineering perspective.

============================================================
CURRENT DEV.TO RISING ARTICLES
============================================================

{topic_text}

============================================================
PREVIOUS TOPICS
============================================================

These are topics already published by this automation.

Avoid repeating them unless there is a genuinely new angle.

{history_text}

============================================================
CONTENT STRATEGY
============================================================

Prefer topics that are:

- currently trending
- useful to software engineers
- practical
- technically deep
- relevant to Staff+ engineers
- relevant to modern frontend/backend engineering
- relevant to AI engineering

Examples:

AI coding agents
AI-assisted development
LLM architecture
Agentic systems
MCP
RAG
AI coding workflows
React architecture
Micro Frontends
Frontend performance
System Design
Distributed Systems
Event-driven architecture
Developer productivity
Software architecture
Engineering leadership

============================================================
ARTICLE REQUIREMENTS
============================================================

Write approximately 1500-2500 words.

The article should contain:

1. Strong title

2. A compelling opening

3. The engineering problem

4. Clear explanation of the concept

5. How it works

6. Practical examples

7. Code examples where useful

8. Mermaid architecture diagrams where useful

9. Real-world trade-offs

10. Common mistakes

11. When to use it

12. When NOT to use it

13. Practical recommendations

14. Strong conclusion

Avoid generic filler.

The article should feel like it was written by a
senior engineer explaining something they deeply understand.

Do NOT claim personal experience that was not provided.

Do NOT say:

"As a Staff Engineer, I..."

unless it is genuinely necessary.

Do NOT mention that the article was generated by AI.

Do NOT reference the source DEV.to articles.

Do NOT use clickbait.

============================================================
DEV.TO METADATA
============================================================

Generate:

title
description
tags

Use 3-5 relevant DEV.to tags.

Tags should be lowercase and contain only letters/numbers.

Examples:

javascript
react
ai
systemdesign
webdev

============================================================
OUTPUT
============================================================

Return ONLY valid JSON.

Use exactly this structure:

{{
  "title": "...",
  "description": "...",
  "tags": ["...", "...", "..."],
  "body_markdown": "..."
}}
"""

    print("Generating article with Gemini...")

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt
    )

    text = response.text.strip()

    # Remove accidental markdown JSON fencing
    if text.startswith("```json"):
        text = text[7:]

    if text.endswith("```"):
        text = text[:-3]

    text = text.strip()

    try:
        article = json.loads(text)
    except json.JSONDecodeError:

        print("Gemini returned invalid JSON:")
        print(text)

        raise

    required = [
        "title",
        "description",
        "tags",
        "body_markdown"
    ]

    for field in required:

        if field not in article:
            raise ValueError(
                f"Missing required field: {field}"
            )

    return article


# ============================================================
# VALIDATE
# ============================================================

def validate_article(article):

    title = article["title"].strip()
    body = article["body_markdown"].strip()
    tags = article["tags"]

    if len(title) < 10:
        raise ValueError(
            "Article title is suspiciously short."
        )

    if len(body) < 1000:
        raise ValueError(
            "Generated article is suspiciously short."
        )

    if not isinstance(tags, list):
        raise ValueError(
            "Tags must be an array."
        )

    if len(tags) == 0:
        raise ValueError(
            "Article has no tags."
        )

    if len(tags) > 5:
        article["tags"] = tags[:5]

    print("Article validation passed.")

    print()
    print("TITLE:")
    print(title)

    print()
    print("TAGS:")
    print(", ".join(article["tags"]))


# ============================================================
# PUBLISH
# ============================================================

def publish_article(article):

    payload = {
        "article": {
            "title": article["title"],
            "description": article["description"],
            "body_markdown": article["body_markdown"],
            "published": True,
            "tags": article["tags"][:5]
        }
    }

    print()
    print("Publishing article to DEV.to...")

    response = requests.post(
        DEVTO_ARTICLES,
        headers={
            "api-key": DEVTO_API_KEY,
            "Content-Type": "application/json"
        },
        json=payload,
        timeout=60
    )

    if response.status_code not in (200, 201):

        print(
            "DEV.to API error:",
            response.status_code
        )

        print(response.text)

        sys.exit(1)

    result = response.json()

    print()
    print("========================================")
    print("ARTICLE PUBLISHED")
    print("========================================")
    print(
        f"Title: {result.get('title')}"
    )
    print(
        f"URL:   {result.get('url')}"
    )
    print("========================================")

    return result


# ============================================================
# MAIN
# ============================================================

def main():

    history = load_history()

    articles = get_trending_articles()

    topics = prepare_topics(articles)

    article = generate_article(
        topics,
        history
    )

    validate_article(article)

    result = publish_article(article)

    # Save topic history AFTER successful publishing

    history.append({
        "title": article["title"],
        "tags": article["tags"],
        "url": result.get("url")
    })

    save_history(history)

    print()
    print("Topic history updated.")


if __name__ == "__main__":
    main()
