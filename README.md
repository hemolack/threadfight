# Thread Fight: Chrome extension (v1.1.0)

Thread Fight turns a Facebook, LinkedIn or Reddit comment-section argument into an animated martial-arts fight, refereed by an LLM you choose. You can download the result as an MP4.

## Using it

1. Open a post and expand the comments, replies and "See more" text you want included. **Only comments visible on the page are counted.** The extension never clicks or opens anything.
2. Click the **Thread Fight** fist in the toolbar. The first time, read the disclosure and click **I agree**.
3. Pick the post. The one open or most on-screen is preselected, and hovering an entry outlines it on the page. Then click **Start the fight**. If you open more comments afterwards, click **Re-scan** before starting.
4. A result tab opens. It referees the thread, plays the fight and shows the scorecard. From there you can:
   - download the MP4
   - edit any ruling and re-render
   - re-referee
   - see exactly what was sent to the model

If the page's layout isn't recognized, the popup offers **Use visible page text** instead.

## Settings (toolbar popup → Settings)

| Choice | What to enter |
|---|---|
| Claude (Anthropic) | API key. Default model `claude-sonnet-5-5`. |
| ChatGPT (OpenAI) | API key. Default model `gpt-5`. |
| Local / custom: OpenAI API | Base URL including `/v1`: Ollama `http://localhost:11434/v1`, LM Studio `http://localhost:1234/v1`, or `http://<lan-host>:<port>/v1`. Key optional. |
| Local / custom: Anthropic API | Any server that implements `/v1/messages`. |

- **Fetch models** lists the server's models, and **Test connection** checks the key and URL.
- If the server is on another machine, Chrome asks you to allow that address when you click **Save**.

**Local server notes**
- **Ollama:** needs `OLLAMA_ORIGINS="chrome-extension://*"`.
- **LM Studio:** needs **Enable CORS** turned on.
- **Reasoning models:** for local servers, the extension asks the model to skip thinking (Qwen3 `/no_think`, plus `enable_thinking: false` where supported). If a reply still has no JSON, the error shows what the model said and why it stopped.

## Permissions and privacy

- **Page access:** `activeTab` + `scripting` mean the extension can't see any page until you click its button, and then only that tab.
- **API hosts:** host permissions cover only Anthropic, OpenAI and localhost. Any other server address is requested at runtime, for that one address only.
- **Anonymizing:** names are replaced with `User N` before sending.
- **No backend:** there is no Thread Fight server. Keys and settings stay in `chrome.storage.local`, and the captured thread lives in session storage until the browser closes. The full policy is in `privacy.html`.

## How capture works

- **Facebook:** comment articles are found by their English-locale ARIA labels ("Comment by …", "Reply by … to …'s comment"). Replies are linked to the comment they answer.
- **LinkedIn:** the scraper uses the `comments-comment-entity` / `comments-comment-item` article classes, and treats an article nested inside another as its reply.
- **Reddit:** both front ends are supported, detected from the page itself (signed-in users can set www.reddit.com to show the old design):
  - current Reddit: `<shreddit-comment>` elements, using their `author`, `thingid` and `parentid` attributes; collapsed comments are skipped.
  - old.reddit.com: `.thing.comment` blocks, where nesting gives the reply structure.
  - AutoModerator, `[deleted]` and `[removed]` comments are dropped, and replies to a dropped comment attach to its parent.
- **Hidden comments:** anything collapsed or hidden (zero-size) is skipped.

All three sites change their markup often, so if a thread isn't recognized, the selectors in `content.js` are where to look.

## Files

```
manifest.json         MV3: storage, activeTab, scripting; API hosts; optional hosts for custom servers
popup.html/.js/.css   toolbar popup: consent, thread picker, visible-only notice
content.js            read-only page reader (injected on click)
background.js         opens settings on install; opens the result tab
options.html/.js      provider setup
fight.html/.js/.css   referee call, player, scorecard, export, script editor
privacy.html          bundled privacy policy
lib/referee.js        LLM clients, prompt, anonymizer, script validation
lib/engine.js         choreography + canvas renderer
lib/sfx.js            synthesized sound effects
lib/encode.js         WebCodecs → MP4 export (mp4-muxer), MediaRecorder fallback
lib/mp4-muxer.js      mp4-muxer 5.2.2 (MIT, see mp4-muxer.LICENSE)
fonts/                Inter (SIL OFL)
```
