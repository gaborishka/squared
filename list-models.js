import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

async function run() {
    try {
        const response = await ai.models.list();
        for await (const model of response) {
            if (!model.name.includes('flash')) continue;
            console.log(model.name, JSON.stringify(model));
        }
    } catch (e) {
        console.error("Error connecting:", e.message || e);
    }
}

run();
