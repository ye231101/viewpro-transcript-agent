# viewpro-transcript-agent

A [LiveKit Agents](https://docs.livekit.io/agents/) worker that joins LiveKit rooms and transcribes participants’ microphone audio using [Deepgram](https://deepgram.com/) (Nova 3). Final and interim transcripts are written to the worker logs with the speaker’s identity.

## Requirements

- Node.js (project uses TypeScript; see `package.json` for toolchain)
- A LiveKit project ([LiveKit Cloud](https://cloud.livekit.io/) or self-hosted) with API credentials
- A [Deepgram](https://console.deepgram.com/) API key for speech-to-text

## Setup

```bash
npm install
```

Create a `.env` file in the project root (the agent loads it via `dotenv`). Use values from your LiveKit project and Deepgram account.

| Variable | Description |
| --- | --- |
| `LIVEKIT_URL` | WebSocket URL for your LiveKit server (required by the Agents worker). |
| `LIVEKIT_API_KEY` | LiveKit API key. |
| `LIVEKIT_API_SECRET` | LiveKit API secret. |
| `DEEPGRAM_API_KEY` | API key for Deepgram STT. |
| `TRANSCRIPT_AGENT_NAME` | Optional. Worker agent name used when registering with LiveKit. Defaults to `viewpro-transcript-agent`. |

See the [LiveKit Agents (JavaScript)](https://docs.livekit.io/agents/) documentation for how workers receive jobs and connect to rooms.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run `src/agent.ts` in watch mode with the `dev` CLI subcommand (hot reload during development). |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run the compiled worker (`dist/agent.js`) with the `start` subcommand (production-style). |

## Behavior

- On each job, the agent connects to the room and subscribes to remote **microphone** audio tracks.
- Audio is streamed to Deepgram STT (English, interim results enabled); transcripts are logged as `[TRANSCRIPT]` / `[PARTIAL TRANSCRIPT]` with the participant identity.
- When a track is unsubscribed, the corresponding speech stream is closed.

To dispatch this agent from your app, use the same agent name as `TRANSCRIPT_AGENT_NAME` (or the default) when creating agent jobs in LiveKit.
