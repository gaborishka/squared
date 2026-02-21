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
        tools: [{
          functionDeclarations: [{
            name: "updateIndicators",
            description: "Update the visual indicators on the user's screen based on their current performance.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                pace: { type: Type.STRING }
              },
              required: ["pace"]
            }
          }]
        }]
      },
      callbacks: {
        onerror: (err) => console.error("Session Error:", err),
        onclose: (event) => console.log("Session Closed", event),
        onopen: () => console.log("Session Opened with latest")
      }
    });

    setTimeout(() => { session.close(); }, 3000);
  } catch (e) {
    console.error("Error connecting:", e.message || e);
  }
}

run();
