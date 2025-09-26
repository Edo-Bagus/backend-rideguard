import admin from "firebase-admin";
import serviceAccount from "../../../firebase.json" assert { type: "json" };
import { NextRequest } from "next/server";

interface NotifyRequestBody {
  token: string;
  title?: string;
  body?: string;
}


// Inisialisasi Firebase Admin SDK (hanya sekali)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
  });
}


export async function POST(req: NextRequest) {
  try {
    const body: NotifyRequestBody = await req.json();
    const { token, title, body: messageBody } = body;

    if (!token) {
      return new Response(JSON.stringify({ error: "FCM token is required" }), { status: 400 });
    }

    const message = {
      notification: {
        title: title || "Default Title",
        body: messageBody || "Default Body",
      },
      token,
    };

    const response = await admin.messaging().send(message);

    return new Response(JSON.stringify({ success: true, response }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending message:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500 });
  }
}
