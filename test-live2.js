import { GoogleGenAI, Modality, Type } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function run() {
    try {
        const sessionInstruction = "You are a helpful assistant.";
        const session = await ai.live.connect({
            model: "gemini-2.5-flash-native-audio-latest",
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
                },
                systemInstruction: sessionInstruction,
            }
        });

        session.on('error', (err) => console.error("Session Error:", err));
        session.on('close', (event) => console.log("Session Closed", event.kReason || event));
        session.on('open', () => { console.log("Session Opened with gemini-2.5-flash-native-audio-latest"); setTimeout(() => session.close(), 1000); });

    } catch (e) {
        console.error("Error connecting:", e.message || e);
    }
}

run();
