import { TOPICS, TRACKS } from '../../../content/index.js?v=7';
import { frag } from '../dom.js';

export default async function about() {
  return frag(`
    <h1>About &amp; keyboard shortcuts</h1>
    <p class="lead">A static, dependency-light study platform. No build step, no backend, no
    accounts, no analytics. Your progress never leaves your browser.</p>

    <h2>Keyboard shortcuts</h2>
    <div class="tablewrap"><table>
      <thead><tr><th>Key</th><th>Action</th></tr></thead>
      <tbody>
        <tr><td><kbd>⌘K</kbd> / <kbd>Ctrl K</kbd> / <kbd>/</kbd></td><td>Search everything -- topics, sections, flashcards, bank questions</td></tr>
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Next / previous topic within a track</td></tr>
        <tr><td><kbd>space</kbd></td><td>Reveal the answer while reviewing flashcards</td></tr>
        <tr><td><kbd>1</kbd>–<kbd>4</kbd></td><td>Grade a revealed flashcard: again, hard, good, easy</td></tr>
        <tr><td><kbd>?</kbd></td><td>This page</td></tr>
        <tr><td><kbd>esc</kbd></td><td>Close the search palette</td></tr>
      </tbody></table></div>

    <h2>How it is built</h2>
    <div class="grid c2">
      <div class="mini"><b>No build step</b><p>Native ES modules, imported straight by the browser.
      Clone it, serve the folder, done. Deploys to GitHub Pages as-is.</p></div>
      <div class="mini"><b>Content as data</b><p>Every topic is a plain JS module of typed blocks
      rendered by <code>assets/js/blocks.js</code>. Adding a topic is one file plus one line in a
      track index.</p></div>
      <div class="mini"><b>Lazy everything</b><p>Topic bodies are dynamic imports. Mermaid is
      fetched only when a diagram scrolls into view, and the site still works if that fetch fails.</p></div>
      <div class="mini"><b>Local-only state</b><p>Progress, spaced-repetition schedules and mock
      sessions live in localStorage under <code>sea.v2</code>, exportable as JSON.</p></div>
    </div>

    <h2>Adding your own content</h2>
    <div class="card">
      <p>Read <code>CONTENT-SCHEMA.md</code> and copy <code>content/frontend/cdn-and-edge.js</code>
      as your template. Then add a metadata entry to the relevant <code>content/&lt;track&gt;/index.js</code>.</p>
      <pre><code># serve locally
python3 -m http.server 8080

# or
npx serve .</code></pre>
      <p class="small muted">Opening <code>index.html</code> directly from the filesystem will not
      work -- browsers block ES module imports over <code>file://</code>.</p>
    </div>

    <h2>Scope</h2>
    <div class="card">
      <p>${TOPICS.length} topics across ${TRACKS.length} tracks, each with trade-offs, failure
      modes, a Staff-level interview angle, quizzes, flashcards and an open-ended drill with a
      grading key. Plus a question bank, and a timed six-phase mock interview with a self-grade
      rubric and gap analysis.</p>
      <p class="small muted">Content is written to be accurate and durable rather than exhaustive.
      Where a figure is quoted it is an order-of-magnitude guide, not a benchmark -- measure your
      own system. Corrections are more welcome than additions.</p>
    </div>
  `);
}
