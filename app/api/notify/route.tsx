import admin from "firebase-admin";
import { NextRequest } from "next/server";

interface NotifyRequestBody {
  token: string;
  title?: string;
  body?: string;
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      clientId: process.env.FIREBASE_CLIENT_ID,
      authUri: process.env.FIREBASE_AUTH_URI,
      tokenUri: process.env.FIREBASE_TOKEN_URI,
      authProviderX509CertUrl: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      clientC509CertUrl: process.env.FIREBASE_CLIENT_X509_CERT_URL,
      universeDomain: process.env.FIREBASE_UNIVERSE_DOMAIN,
    } as admin.ServiceAccount),
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
