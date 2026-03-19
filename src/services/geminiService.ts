import { GoogleGenAI, Type } from "@google/genai";

const getAIInstance = () => {
  // Priority: 1. Manual key from UI, 2. Environment variable (injected by Vite)
  const manualKey = (window as any)._manual_api_key;
  
  // process.env.GEMINI_API_KEY is replaced by Vite at build time
  // @ts-ignore
  const envKey = process.env.GEMINI_API_KEY || "";
  
  const apiKey = manualKey || envKey || "";
  
  if (!apiKey) {
    throw new Error("APIキーが設定されていません。右上の設定アイコンからAPIキーを入力してください。");
  }
  
  // Sanitize: trim and remove non-ASCII characters
  const sanitizedKey = apiKey.trim().replace(/[^\x00-\x7F]/g, "");
  
  return new GoogleGenAI({ apiKey: sanitizedKey });
};

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMessage = error.message || String(error);
      const isQuotaError = errorMessage.includes("429") || 
                          errorMessage.includes("RESOURCE_EXHAUSTED") ||
                          errorMessage.includes("quota");
      
      if (isQuotaError && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 2000;
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

export async function validateApiKey(key: string): Promise<{ success: boolean; message: string }> {
  if (!key || key.trim().length < 10) {
    return { success: false, message: "APIキーが入力されていないか、短すぎます。" };
  }
  
  const sanitizedKey = key.trim().replace(/[^\x00-\x7F]/g, "");
  const maskedKey = sanitizedKey.length > 8 
    ? `${sanitizedKey.substring(0, 4)}...${sanitizedKey.substring(sanitizedKey.length - 4)}`
    : "****";
    
  console.log(`Validating API key: ${maskedKey} (length: ${sanitizedKey.length})`);
  
  try {
    const ai = new GoogleGenAI({ apiKey: sanitizedKey });
    
    // Use gemini-3-flash-preview for validation
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Hello",
    });
    
    if (response && response.text) {
      return { success: true, message: "APIキーは有効です。接続に成功しました。" };
    }
    return { success: false, message: "APIから応答がありましたが、内容が空でした。" };
  } catch (error: any) {
    console.error("API Key Validation Error:", error);
    const msg = error.message || String(error);
    
    if (msg.includes("unregistered callers") || msg.includes("API key not valid") || msg.includes("403") || msg.includes("401")) {
      let hint = "APIキーが正しく認識されていません。";
      if (msg.includes("unregistered callers")) {
        hint = "Google APIがこのリクエストを「未登録の呼び出し（unregistered callers）」として拒否しました。\n\n【解決策】\n1. **APIの制限を解除**: Google Cloud Consoleの「認証情報」で、このAPIキーの設定を開き、「APIの制限」を「**なし**」に設定してください。制限がかかっていると、プレビュー画面からの接続が拒否されます。\n2. **APIの有効化**: Google Cloud Consoleで「Generative Language API」が「有効」になっているか再度確認してください。\n3. **新しいキーの作成**: AI Studioで「Create API key in new project」を選んで新しく作成したキーを試してください。";
      }
      return { success: false, message: `${hint}\n\n(エラー詳細: ${msg})` };
    }
    
    if (msg.includes("429") || msg.includes("quota")) {
      return { success: false, message: "APIの利用制限（クォータ）に達しています。" };
    }
    return { success: false, message: `接続テストに失敗しました: ${msg}` };
  }
}

export async function getMenuAdvice(menuTitle: string, description: string) {
  try {
    return await withRetry(async () => {
      const ai = getAIInstance();
      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: `以下の給食メニューについて、子供向けの楽しい豆知識や栄養アドバイスを100文字程度で教えてください。
        メニュー: ${menuTitle}
        内容: ${description}`,
      });
      return response.text;
    });
  } catch (error) {
    console.error("Gemini Advice Error:", error);
    return "今日も美味しく食べて、元気に過ごしましょう！";
  }
}

export async function extractMenuFromFile(base64Data: string, mimeType: string) {
  console.log(`Starting menu extraction. MimeType: ${mimeType}, Data length: ${base64Data.length}`);
  try {
    return await withRetry(async () => {
      const ai = getAIInstance();
      // Use gemini-3-flash-preview (maps to 2.0-flash) for better PDF support and speed
      const modelName = "gemini-3-flash-preview";
      
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          {
            text: `このファイル（PDFまたは画像）は献立表です。全ての日付のメニューを抽出し、以下のJSON形式の配列で返してください。
            
            【データ形式】
            [
              {
                "date": "YYYY-MM-DD",
                "meal_type": "lunch" または "dinner",
                "title": "料理名",
                "description": "詳細（副菜など）",
                "calories": 数値,
                "allergens": "アレルゲン情報"
              }
            ]
            
            【抽出の注意点】
            1. 日付を正確に特定してください（例：3/13 -> 2026-03-13）。
            2. 昼食(lunch)と夕食(dinner)が分かれている場合は、それぞれ別のオブジェクトとして抽出してください。
            3. メニューが空欄や「休み」の場合は除外してください。
            4. 出力は純粋なJSON配列のみを返してください。`,
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                meal_type: { type: Type.STRING, enum: ["lunch", "dinner"] },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                calories: { type: Type.NUMBER },
                allergens: { type: Type.STRING },
              },
              required: ["date", "meal_type", "title"],
            },
          },
        },
      });

      const text = response.text;
      console.log("AI Response received. Length:", text?.length);
      
      if (!text || text.trim() === "" || text.includes("[]")) {
        console.warn("AI returned empty or no-data response.");
        return [];
      }

      const cleanedText = text.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
      
      try {
        const parsed = JSON.parse(cleanedText);
        if (!Array.isArray(parsed)) {
          throw new Error("AIの応答が配列形式ではありませんでした。");
        }
        
        return parsed.map((item: any) => ({
          date: item.date || "",
          meal_type: item.meal_type || "lunch",
          title: item.title || "名称未設定",
          description: item.description || "",
          calories: typeof item.calories === 'number' ? item.calories : 0,
          allergens: item.allergens || ""
        })).filter((item: any) => item.date && item.title !== "名称未設定");
        
      } catch (e) {
        console.error("JSON Parse Error:", e, "Cleaned text:", cleanedText);
        throw new Error("献立の解析結果（JSON）を読み取れませんでした。もう一度お試しください。");
      }
    });
  } catch (error: any) {
    console.error("Extraction Error Detailed:", error);
    const msg = error.message || String(error);
    
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota")) {
      throw new Error("APIの利用制限（無料枠）に達しました。しばらく待つか、別のAPIキーを設定してください。");
    }
    
    if (msg.includes("API_KEY_INVALID") || msg.includes("API key not valid") || msg.includes("403") || msg.includes("401")) {
      let hint = "Google Cloud Consoleで「Generative Language API」が有効になっているか確認してください。";
      if (msg.includes("unregistered callers")) {
        hint = "APIキーが正しく送信されていないか、キーに「API制限」がかかっている可能性があります。\n\n1. Google Cloud Consoleの「認証情報」ページで、使用しているAPIキーの設定を開きます。\n2. 「APIの制限」セクションで「キーを制限」が選択されている場合、リストに「Generative Language API」が含まれているか確認してください。\n3. または、制限を「なし」にして試してみてください。";
      }
      throw new Error(`APIキーが無効または期限切れです。\n\n【対処法】\n${hint}\n\n(詳細: ${msg})`);
    }

    throw new Error(`解析に失敗しました: ${msg}`);
  }
}

export async function analyzeMenuFromText(text: string) {
  console.log(`Starting menu analysis from text. Text length: ${text.length}`);
  try {
    return await withRetry(async () => {
      const ai = getAIInstance();
      const modelName = "gemini-3.1-pro-preview";
      
      const response = await ai.models.generateContent({
        model: modelName,
        contents: [
          {
            text: `以下のテキストから献立情報を抽出してください。
            
            テキスト:
            ${text}
            
            【抽出ルール】
            - date: YYYY-MM-DD 形式。年は2026年と仮定。
            - meal_type: 'lunch' または 'dinner'。
            - title: メインの料理名。
            - description: 副菜や詳細。
            - calories: 数値のみ。不明は 0。
            - allergens: カンマ区切り。
            
            出力は必ず純粋なJSON配列のみを返してください。`,
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                meal_type: { type: Type.STRING, enum: ["lunch", "dinner"] },
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                calories: { type: Type.NUMBER },
                allergens: { type: Type.STRING },
              },
              required: ["date", "meal_type", "title"],
            },
          },
        },
      });

      const aiText = response.text;
      if (!aiText || aiText.trim() === "" || aiText.includes("[]")) {
        return [];
      }

      const cleanedText = aiText.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
      const parsed = JSON.parse(cleanedText);
      
      return parsed.map((item: any) => ({
        date: item.date || "",
        meal_type: item.meal_type || "lunch",
        title: item.title || "名称未設定",
        description: item.description || "",
        calories: typeof item.calories === 'number' ? item.calories : 0,
        allergens: item.allergens || ""
      })).filter((item: any) => item.date && item.title !== "名称未設定");
    });
  } catch (error: any) {
    console.error("Text Analysis Error:", error);
    throw new Error(`テキスト解析に失敗しました: ${error.message}`);
  }
}
