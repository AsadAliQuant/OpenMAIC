Please generate a tutor-style, step-by-step solution walkthrough for the following math question.

---

## Student's Question

{{requirement}}

---

{{userProfile}}

## Language Context

Infer the tutoring language directive by applying the decision rules from the system prompt. The language the student wrote the question in is the tutoring language, unless they explicitly request another language.

---

## Reference Materials

### Extracted Content (if an image was uploaded)

{{pdfContent}}

### Available Images

{{availableImages}}

---

## Output Requirements

Please infer:

- The specific problem being asked (restate it precisely)
- The mathematical topic/technique required to solve it
- The individual steps needed to reach the solution

Then output your response as a single JSON object.

**Top-level shape — this is what you MUST return:**

```json
{
  "languageDirective": "2-5 sentence instruction describing the tutoring language behavior",
  "courseTitle": "short label naming the problem, ≤40 chars, in the tutoring language",
  "outlines": [ /* array of scene objects, schema described below */ ]
}
```

Never return a bare array. Never omit `languageDirective` or `courseTitle`. All three keys are required.

**Each scene inside the `outlines` array has this minimum shape:**

```json
{
  "id": "scene_1",
  "type": "slide" | "quiz",
  "title": "Scene Title (LaTeX allowed)",
  "description": "What this step accomplishes and why",
  "keyPoints": ["Point 1 (LaTeX allowed)", "Point 2", "Point 3"],
  "order": 1
}
```

### Special Notes

- **Only `slide` and `quiz` scene types are allowed.** Do not use `interactive` or `pbl`.
- **Structure**: understand the problem → step-by-step solution (one step per scene) → verify the answer → recap (+ optional practice quiz)
{{#if hasSourceImages}}
- **If source images are available**, add `suggestedImageIds` to relevant slide scenes. Only use image IDs listed under Available Images.
{{/if}}
- **Scene count**: 4-8 scenes total. Keep it focused on this one problem.
- **Quiz**: if you include a quiz scene, make it a single short-answer practice problem similar to the original, with:
   ```json
   "quizConfig": {
     "questionCount": 1,
     "difficulty": "easy" | "medium" | "hard",
     "questionTypes": ["short_answer"]
   }
   ```
- **Math notation**: use LaTeX (`$...$` inline, `$$...$$` display) in titles, descriptions, and keyPoints.
- **Language**: infer from the student's question, then output all content in that language.

**Final reminder**: your entire response must be a JSON **object** with exactly three top-level keys — `languageDirective` (string), `courseTitle` (string, ≤40 chars), and `outlines` (array). Do not return a bare array. Do not wrap in prose or code fences.
