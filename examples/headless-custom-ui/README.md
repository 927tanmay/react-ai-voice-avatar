# React Indic Avatar — Enterprise Headless & Custom UI Example

This example demonstrates how to deploy `react-indic-avatar` in a **headless UI mode**, removing all default on-screen DOM overlays in order to embed the 3D avatar within a custom corporate design system.

## Key Concepts Demonstrated

1. **Headless Canvas Setup**:
   - Setting `hideStatusPill={true}` and `showCaptions={false}` completely suppresses our internal floating control components and subtitle boxes.
2. **Imperative Speech Triggering (`speak(text)`)**:
   - By binding to `IndicAvatarHandle` via `useRef<IndicAvatarHandle>(null)`, you can programmatically command the 3D digital character to speak any script or alert out loud at any time:
     ```tsx
     avatarRef.current?.speak("Hello! Welcome to our enterprise digital reception.");
     ```
3. **Custom Live Transcript Stream**:
   - Subscribing to `onTranscriptUpdate={(text, speaker) => { ... }}` lets you route user microphone transcribing and avatar speech responses directly into your custom conversation layout, messaging bubbles, or audit logs.

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your WebGPU-capable browser!
