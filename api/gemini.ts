import { GoogleGenAI } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { prompt, content } = req.body;

    if (!prompt || !content) {
      return res.status(400).json({ error: 'Missing prompt or content in request body' });
    }
    
    // De acordo com as diretrizes da API Gemini, assuma que a API_KEY está sempre disponível em process.env.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const fullPrompt = `${prompt}\n\nConteúdo para analisar: "${content}"`;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
        config: {
            temperature: 0.7,
        }
    });

    return res.status(200).json({ text: response.text });

  } catch (error) {
    console.error("Error in Gemini API proxy:", error);
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred.";
    return res.status(500).json({ error: "An error occurred while generating content.", details: errorMessage });
  }
}
