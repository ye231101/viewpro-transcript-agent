import { JobContext, JobProcess, WorkerOptions, cli, defineAgent, log, stt } from '@livekit/agents';
import * as deepgram from '@livekit/agents-plugin-deepgram';
import {
  AudioStream,
  RoomEvent,
  TrackKind,
  TrackSource,
  type RemoteParticipant,
} from '@livekit/rtc-node';
import { config } from './config';
import dotenv from 'dotenv';
dotenv.config();

function isClient(participant: RemoteParticipant): boolean {
  return participant.identity === config.clientName;
}

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.stt = new deepgram.STT({
      model: 'nova-3',
      language: 'en-US',
      smartFormat: true,
      punctuate: true,
      interimResults: false,
      endpointing: 500,
    });
  },

  entry: async (ctx: JobContext) => {
    const logger = log();

    await ctx.connect();

    const room = ctx.room;
    const agent = ctx.agent;
    logger.info(`Agent joined room: ${room.name}`);

    const publishTranscriptToDataChannel = async (kind: 'final' | 'interim', text: string) => {
      if (!agent) {
        logger.warn('Cannot publish transcript: local participant not ready');
        return;
      }
      const payload = JSON.stringify({
        id: crypto.randomUUID(),
        username: 'transcript-agent',
        message: text,
        time: Date.now(),
        source: 'transcript',
        type: kind,
      });
      try {
        await agent.publishData(new TextEncoder().encode(payload), {
          topic: 'transcript',
          reliable: kind === 'final',
        });
      } catch (err: unknown) {
        logger.error({ err }, 'Failed to publish transcript on data channel');
      }
    };

    const sttInstance: stt.STT = ctx.proc.userData.stt as stt.STT;

    const activeStreams = new Map<string, stt.SpeechStream>();

    const startTranscription = async (
      track: any,
      publication: any,
      participant: RemoteParticipant,
    ) => {
      if (!isClient(participant)) {
        return;
      }

      if (
        track.kind !== TrackKind.KIND_AUDIO ||
        publication.source !== TrackSource.SOURCE_MICROPHONE ||
        !publication.sid
      ) {
        return;
      }

      if (activeStreams.has(publication.sid)) {
        return;
      }

      logger.info(`Subscribed to audio track from: ${participant.identity}`);

      const stream = await sttInstance.stream();
      activeStreams.set(publication.sid, stream);

      void (async () => {
        try {
          const audioStream = new AudioStream(track, { sampleRate: 48000, numChannels: 1 });
          for await (const frame of audioStream) {
            stream.pushFrame(frame as any);
          }
        } catch (err: unknown) {
          logger.error({ err, participant: participant.identity }, 'Error streaming audio frames');
        } finally {
          stream.close();
          activeStreams.delete(publication.sid);
        }
      })();

      (async () => {
        for await (const event of stream) {
          if (
            event.type === stt.SpeechEventType.FINAL_TRANSCRIPT &&
            event.alternatives?.[0]?.text
          ) {
            const transcript = event.alternatives[0].text.trim();
            if (!transcript) continue;
            logger.info(`[TRANSCRIPT] ${participant.identity}: ${transcript}`);
            await publishTranscriptToDataChannel('final', transcript);
          }

          if (
            event.type === stt.SpeechEventType.INTERIM_TRANSCRIPT &&
            event.alternatives?.[0]?.text
          ) {
            const partial = event.alternatives[0].text.trim();
            if (!partial) continue;
            logger.info(`[PARTIAL TRANSCRIPT] ${participant.identity}: ${partial}`);
          }
        }
      })().catch((err: unknown) => {
        logger.error({ err, participant: participant.identity }, 'Error reading STT events');
      });
    };

    for (const participant of room.remoteParticipants.values()) {
      if (!isClient(participant)) {
        logger.info(`Skipping STT (not Client): ${participant.identity}`);
        continue;
      }
      logger.info(`Setting up STT for participant: ${participant.identity}`);
      for (const publication of participant.trackPublications.values()) {
        if (publication.track) {
          void startTranscription(publication.track, publication, participant);
        }
      }
    }

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      void startTranscription(track, publication, participant);
    });

    room.on(RoomEvent.TrackUnsubscribed, (_track, publication, participant) => {
      if (!publication.sid) return;
      if (!activeStreams.has(publication.sid)) return;
      logger.info(`Audio track ended for: ${participant.identity}`);
    });

    room.on(RoomEvent.Disconnected, () => {
      logger.info('Room disconnected, agent exiting.');
    });
  },
});

cli.runApp(
  new WorkerOptions({
    agent: __filename,
    agentName: config.transcriptAgentName,
    requestFunc: async (req) => {
      await req.accept('ViewPro Transcript Agent', config.transcriptAgentName);
    },
  }),
);
