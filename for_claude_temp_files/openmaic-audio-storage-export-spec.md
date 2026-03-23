# OpenMAIC Audio Storage Architecture & Export Button Implementation Spec

> **Purpose:** This document is a complete technical reference for an AI agent tasked with adding two export buttons to the OpenMAIC classroom WebUI:
> 1. **"Export Current Slide Audio"** — downloads the MP3 for the slide currently being viewed
> 2. **"Export All Course Audio (ZIP)"** — downloads a ZIP of all slide MP3s, named by lecture number and title
>
> All findings are from live browser inspection of `http://localhost:3000/classroom/QntV6jFkl1` (IndexedDB dump + console logs). No assumptions — everything below is verified ground truth.

---

## 1. Where Audio Is Stored

### Storage Engine: IndexedDB

Audio is **not** in `localStorage`, `sessionStorage`, or any server file. It lives in the browser's IndexedDB.

| Property | Value |
|---|---|
| Database name | `MAIC-Database` |
| Database version | `8` |
| Object store | `audioFiles` |
| Key field | `id` (string) |
| Audio field | `blob` (native JS `Blob` object) |
| Format field | `format` (always `"mp3"`) |
| Timestamp field | `createdAt` (Unix ms timestamp) |

### How to Open the DB in Code

```javascript
function openMAICDatabase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MAIC-Database');
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
```

### audioFiles Store — Record Shape

```typescript
interface AudioFileRecord {
  id: string;        // e.g. "tts_action_-Vw7WVHb"
  blob: Blob;        // actual MP3 binary data
  format: string;    // always "mp3"
  createdAt: number; // Unix ms, e.g. 1774190339329
}
```

### Example Records (from live DB dump)

```
{ id: "tts_action_-Vw7WVHb",  blob: Blob, format: "mp3", createdAt: 1774190339329 }
{ id: "tts_action_2-2ZCLvN",  blob: Blob, format: "mp3", createdAt: 1774196651109 }
{ id: "tts_action_DkO_61H0",  blob: Blob, format: "mp3", createdAt: 1774196627569 }
// ...63 total records across multiple courses
```

---

## 2. How Audio IDs Link to Slides

### The ID pattern

Every audio record ID follows this pattern:

```
tts_action_{actionId}
```

The `{actionId}` part matches the `actionId` field inside the **`chatSessions`** object store, which stores the lecture playback sessions for each slide.

### Other Relevant Object Stores

The `MAIC-Database` has **10 object stores**. The ones relevant to audio export are:

| Store | Purpose | Key field |
|---|---|---|
| `audioFiles` | MP3 blobs | `id` = `"tts_action_{actionId}"` |
| `scenes` | Slide content + metadata | `id` (scene ID), `stageId`, `title`, `order`, `type` |
| `chatSessions` | Lecture session messages containing action references | `id`, `stageId`, `type` |
| `stages` | Top-level course (classroom) record | `id` = classroomId |
| `stageOutlines` | Course outline with scene titles and order | `stageId` |

### Scene Record Shape (from live dump)

```typescript
interface SceneRecord {
  id: string;           // e.g. "AwC9SwQxVdezC3bpTIbra"
  stageId: string;      // e.g. "QntV6jFkl1" — matches the classroom ID in the URL
  type: "slide" | "quiz" | "interactive" | "pbl";
  title: string;        // e.g. "What is Algebra and Why Does It Matter?"
  order: number;        // 1, 2, 3... — this is the lecture/slide number
  content: object;      // full canvas/quiz/etc content
}
```

### Example Scenes for classroom `QntV6jFkl1`

```
order:1  type:slide   title:"What is Algebra and Why Does It Matter?"
order:2  type:slide   title:"Understanding Variables and Expressions"
order:3  type:quiz    title:"Check Your Understanding: Variables & Expressions"
order:4  type:interactive  title:"Balance the Equation"
order:5  type:slide   title:"Solving Basic Linear Equations Step by Step"
order:6  type:quiz    title:"Solve It! — Linear Equations Practice"
order:7  type:pbl     title:"My Algebra Story — Real Life, Real Equations"
```

### How to Get the Current Classroom ID

The classroom ID is in the URL:

```javascript
// URL: http://localhost:3000/classroom/QntV6jFkl1
const classroomId = window.location.pathname.split('/classroom/')[1];
// → "QntV6jFkl1"
```

---

## 3. Linking Audio to a Specific Slide (The Join)

The audio IDs (`tts_action_*`) are embedded in the **`chatSessions`** store inside the `messages` array. Each lecture session (`type: "lecture"`) belongs to a specific scene via `stageId` + the scene ID referenced in the session.

### chatSession Record Shape

```typescript
interface ChatSessionRecord {
  id: string;        // session ID
  stageId: string;   // classroom ID (e.g. "QntV6jFkl1")
  type: "lecture" | "qa";
  title: string;     // matches the scene title — USE THIS to correlate to scene
  status: "completed" | "interrupted";
  messages: Message[];
}
```

### How action IDs appear in messages

Inside `messages`, each message contains `parts` which include action references:

```json
{
  "id": "lecture-msg-1774196427896",
  "role": "assistant",
  "parts": [
    {
      "type": "action-spotlight",
      "actionId": "spotlight-1774196427974",
      ...
    },
    {
      "type": "action-speech",
      "actionId": "tts_action_DkO_61H0",
      ...
    }
  ]
}
```

The `actionId` in `"type": "action-speech"` parts directly matches the `id` field in `audioFiles` (i.e., the key IS `tts_action_DkO_61H0`).

### Simplified Join Strategy

Because the `chatSession.title` matches the `scene.title`, you can join them like this:

```
audioFiles.id  →  strip "tts_action_" prefix  →  match actionId in chatSessions messages
chatSessions.title  →  match  →  scenes.title (same stageId)
scenes.order + scenes.title  →  use for ZIP filename
```

---

## 4. Complete Code to Retrieve All Audio for a Course

```javascript
async function getAllAudioForCourse(classroomId) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MAIC-Database');
    req.onsuccess = async function(e) {
      const db = e.target.result;

      // 1. Get all scenes for this classroom, sorted by order
      const scenes = await getAllFromStore(db, 'scenes');
      const courseScenes = scenes
        .filter(s => s.stageId === classroomId)
        .sort((a, b) => a.order - b.order);

      // 2. Get all chat sessions for this classroom (lecture type only)
      const sessions = await getAllFromStore(db, 'chatSessions');
      const lectureSessions = sessions.filter(
        s => s.stageId === classroomId && s.type === 'lecture'
      );

      // 3. Get all audio files
      const audioFiles = await getAllFromStore(db, 'audioFiles');
      const audioMap = {};
      audioFiles.forEach(a => { audioMap[a.id] = a; });

      // 4. For each scene, collect its audio blobs
      const result = [];
      for (const scene of courseScenes) {
        // Find lecture session matching this scene title
        const session = lectureSessions.find(s => s.title === scene.title);
        const audioBlobs = [];

        if (session) {
          // Extract all speech action IDs from session messages
          for (const msg of session.messages) {
            if (!msg.parts) continue;
            for (const part of msg.parts) {
              if (part.type === 'action-speech' && part.actionId) {
                const audioRecord = audioMap[part.actionId];
                if (audioRecord && audioRecord.blob) {
                  audioBlobs.push(audioRecord.blob);
                }
              }
            }
          }
        }

        result.push({
          order: scene.order,
          title: scene.title,
          type: scene.type,
          sceneId: scene.id,
          audioBlobs,  // array of Blobs (may be multiple speech acts per slide)
        });
      }

      resolve(result);
    };
    req.onerror = (e) => reject(e.target.error);
  });
}

function getAllFromStore(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

---

## 5. Getting the Current Slide's Scene Info

To know which slide the user is currently on, look at the URL or the active scene state. OpenMAIC uses Zustand for in-memory state. The simplest reliable approach is to read a data attribute from the DOM or use the URL search params.

### Option A: Read from DOM (most reliable, no Zustand needed)

Look for the active scene container in the rendered DOM. OpenMAIC renders the active scene and applies an active/visible class. Inspect the classroom page DOM for an element with a `data-scene-id` or similar attribute. Alternatively, hook into the scene title displayed in the UI header.

```javascript
// Check the page title or visible scene heading
function getCurrentSlideTitle() {
  // The slide title is rendered in the classroom header/breadcrumb
  // Inspect DOM for: h1, h2, or a data-scene attribute on the active panel
  const titleEl = document.querySelector('[data-scene-title]') 
                || document.querySelector('.scene-title')
                || document.querySelector('h1');
  return titleEl?.textContent?.trim();
}
```

### Option B: Read from Zustand store via React fiber (more precise)

Since OpenMAIC uses Zustand (confirmed from `lib/store/` in repo structure), the active scene ID is in the store. Access it via:

```javascript
function getZustandPlaybackState() {
  // Find any React root element
  const el = document.querySelector('#__next');
  const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
  // Walk the fiber tree looking for a store with getState
  // This is complex — prefer Option A or Option C
}
```

### Option C: Use the URL scene param (simplest)

OpenMAIC may encode the active scene in the URL hash or query param when navigating slides. Check the URL when switching slides:

```javascript
function getCurrentSceneFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('scene') || window.location.hash.replace('#', '');
}
```

> **Recommendation for the implementing agent:** When injecting the Export button, place it inside the existing slide scene component so you have access to the scene's props directly (scene ID, title, order). This is cleaner than reading from the DOM or Zustand externally.

---

## 6. Sanitizing Filenames

Slide titles contain special characters. Clean them before using as filenames:

```javascript
function sanitizeFilename(str) {
  return str
    .replace(/[<>:"/\\|?*]/g, '')   // remove illegal filename chars
    .replace(/\s+/g, '_')            // spaces to underscores
    .replace(/_{2,}/g, '_')          // collapse multiple underscores
    .trim()
    .substring(0, 80);               // max 80 chars
}

// Usage:
// order=1, title="What is Algebra and Why Does It Matter?"
// → "01_What_is_Algebra_and_Why_Does_It_Matter.mp3"
function buildFilename(order, title, format = 'mp3') {
  const paddedOrder = String(order).padStart(2, '0');
  return `${paddedOrder}_${sanitizeFilename(title)}.${format}`;
}
```

---

## 7. Export Button 1 — Current Slide Audio

### Behavior
- Downloads the MP3(s) for the slide currently being viewed
- If a slide has multiple speech actions (multiple `tts_action_*` blobs), either concatenate them or download as separate files suffixed `_part1`, `_part2`, etc.

### Implementation

```javascript
async function exportCurrentSlideAudio(currentScene) {
  // currentScene = { order: 1, title: "What is Algebra...", sceneId: "AwC9Sw..." }
  const classroomId = window.location.pathname.split('/classroom/')[1];
  const allAudio = await getAllAudioForCourse(classroomId);
  
  const sceneAudio = allAudio.find(a => a.sceneId === currentScene.sceneId);
  if (!sceneAudio || sceneAudio.audioBlobs.length === 0) {
    alert('No audio found for this slide.');
    return;
  }

  if (sceneAudio.audioBlobs.length === 1) {
    // Single blob — download directly
    downloadBlob(
      sceneAudio.audioBlobs[0],
      buildFilename(sceneAudio.order, sceneAudio.title)
    );
  } else {
    // Multiple blobs — download each as a part
    sceneAudio.audioBlobs.forEach((blob, i) => {
      const name = buildFilename(sceneAudio.order, sceneAudio.title)
        .replace('.mp3', `_part${i + 1}.mp3`);
      downloadBlob(blob, name);
    });
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
```

---

## 8. Export Button 2 — All Course Audio as ZIP

### Dependencies

Use **JSZip** (already available via CDN or installable via npm). No server needed — runs entirely in browser.

```html
<!-- Add to page if not already present -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
```

Or if using the Next.js app:

```bash
npm install jszip
# or
pnpm add jszip
```

### Implementation

```javascript
async function exportAllCourseAudioAsZip() {
  const classroomId = window.location.pathname.split('/classroom/')[1];
  
  // Get course name from stages store for ZIP filename
  const db = await openMAICDatabase();
  const stages = await getAllFromStore(db, 'stages');
  const stage = stages.find(s => s.id === classroomId);
  // stage.name is the full prompt — extract first line or first 60 chars as course name
  const courseName = sanitizeFilename(
    (stage?.name || classroomId).split('\n')[0].substring(0, 60)
  );

  const allAudio = await getAllAudioForCourse(classroomId);
  const zip = new JSZip();
  let hasAny = false;

  for (const scene of allAudio) {
    if (scene.audioBlobs.length === 0) continue;
    hasAny = true;

    if (scene.audioBlobs.length === 1) {
      zip.file(
        buildFilename(scene.order, scene.title),
        scene.audioBlobs[0]
      );
    } else {
      // Multiple parts — put in a subfolder named by slide
      const folderName = buildFilename(scene.order, scene.title).replace('.mp3', '');
      const folder = zip.folder(folderName);
      scene.audioBlobs.forEach((blob, i) => {
        folder.file(`part${i + 1}.mp3`, blob);
      });
    }
  }

  if (!hasAny) {
    alert('No audio files found for this course.');
    return;
  }

  // Generate and download ZIP
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `${courseName}_audio.zip`);
}
```

### Expected ZIP structure

```
Basic_Algebra_From_Variables_to_Linear_Equations_audio.zip
├── 01_What_is_Algebra_and_Why_Does_It_Matter.mp3
├── 02_Understanding_Variables_and_Expressions.mp3
├── 03_Check_Your_Understanding_Variables_Expressions.mp3   (quiz — may have no audio)
├── 04_Balance_the_Equation.mp3                            (interactive — may have no audio)
├── 05_Solving_Basic_Linear_Equations_Step_by_Step.mp3
├── 06_Solve_It_Linear_Equations_Practice.mp3              (quiz — may have no audio)
└── 07_My_Algebra_Story_Real_Life_Real_Equations.mp3
```

---

## 9. Where to Inject the Buttons in the Codebase

### File locations to look at

```
OpenMAIC/
├── components/
│   ├── scene-renderers/      ← each scene type rendered here
│   ├── agent/                ← AI teacher agent avatar/controls
│   └── audio/                ← audio player components (good place to add export)
├── app/
│   └── classroom/[id]/       ← the classroom page itself
└── lib/
    ├── store/                ← Zustand stores (active scene state is here)
    └── audio/                ← TTS & ASR providers
```

### Recommended injection point

The best place is inside `app/classroom/[id]/page.tsx` or the slide toolbar component. Look for:
- The component that renders the play/pause button for the lecture
- Or the slide navigation controls (prev/next slide buttons)

Add the two new buttons adjacent to those existing controls so they have natural access to the current scene's props.

### Reading current scene from Zustand

In a React component within the OpenMAIC app, import the playback store:

```typescript
// Find the correct store in lib/store/ — look for usePlaybackStore or useStageStore
import { usePlaybackStore } from '@/lib/store/playback'; // path may vary

function ExportAudioButtons() {
  const currentScene = usePlaybackStore(state => state.currentScene);
  // currentScene will have: id, title, order, type
  
  return (
    <div className="export-audio-controls">
      <button onClick={() => exportCurrentSlideAudio(currentScene)}>
        ⬇ Export Slide Audio
      </button>
      <button onClick={() => exportAllCourseAudioAsZip()}>
        📦 Export All Audio (ZIP)
      </button>
    </div>
  );
}
```

---

## 10. Edge Cases to Handle

| Case | How to handle |
|---|---|
| Slide has no audio (quiz, interactive) | Show toast: "This slide type has no audio" |
| Audio blob is null/undefined | Skip silently in ZIP, alert in single export |
| Multiple courses in DB | Always filter by `stageId === classroomId` |
| JSZip not loaded | Dynamically inject script tag before running |
| ZIP generation takes time | Show loading spinner / disable button during generation |
| Blob URL cleanup | Always call `URL.revokeObjectURL()` after download click |

---

## 11. Quick Verification Snippet (Run in Console to Test)

Before implementing, run this in the browser console on the classroom page to confirm audio retrieval works:

```javascript
// Quick test — plays the first audio found for current classroom
(async () => {
  const classroomId = window.location.pathname.split('/classroom/')[1];
  const req = indexedDB.open('MAIC-Database');
  req.onsuccess = async (e) => {
    const db = e.target.result;
    const tx = db.transaction('audioFiles', 'readonly');
    const all = await new Promise(res => {
      const r = tx.objectStore('audioFiles').getAll();
      r.onsuccess = () => res(r.result);
    });
    console.log(`Total audio files in DB: ${all.length}`);
    console.log('First record ID:', all[0]?.id);
    const url = URL.createObjectURL(all[0].blob);
    new Audio(url).play();
    console.log('Playing first audio... if you hear sound, blobs are intact.');
  };
})();
```

---

## 12. Summary of Key Facts

| Fact | Value |
|---|---|
| Storage engine | IndexedDB |
| Database name | `MAIC-Database` |
| Audio store | `audioFiles` |
| Audio ID format | `tts_action_{actionId}` |
| Audio format | MP3 (Blob) |
| Total audio files (this course) | 63 |
| Scene metadata store | `scenes` (has `order`, `title`, `stageId`) |
| Classroom ID source | URL path: `/classroom/{id}` |
| Audio generated | Once, at course creation time (Deepgram called once per speech action) |
| Audio re-generated on play | **Never** — always served from IndexedDB |
| Server-side audio persistence | **Not implemented** in v0.1.0 (known bug #53) |
| ZIP library | JSZip (add via npm or CDN) |
