import admin from "firebase-admin";
import { NextRequest, NextResponse } from "next/server";

// Pastikan Firebase Admin SDK sudah diinisialisasi
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

// Fungsi untuk menghitung jarak menggunakan rumus Haversine
function haversine(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Radius bumi dalam kilometer
  const φ1 = lat1 * (Math.PI / 180); // konversi latitude ke radian
  const φ2 = lat2 * (Math.PI / 180); // konversi latitude ke radian
  const Δφ = (lat2 - lat1) * (Math.PI / 180); // selisih latitude
  const Δλ = (lon2 - lon1) * (Math.PI / 180); // selisih longitude

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Mengembalikan jarak dalam kilometer
}

interface Hospital {
  id: string;
  name: string;
  location: {
    _latitude: number;
    _longitude: number;
  };
}

// Fungsi untuk mengambil semua rumah sakit dari Firestore
async function getAllHospitals(): Promise<Hospital[]> {
  try {
    const snapshot = await admin
      .firestore()
      .collection("emergency_services")
      .get();
    const hospitals = snapshot.docs.map((doc) => ({
      id: doc.id,
      name: doc.data().name,
      location: doc.data().location,
    }));
    return hospitals;
  } catch (error) {
    console.error("Error getting hospitals:", error);
    throw new Error("Failed to retrieve hospitals.");
  }
}

// Fungsi untuk memeriksa apakah crash_id sudah ada di Firestore
async function checkCrashExists(crashId: string): Promise<boolean> {
  try {
    const doc = await admin
      .firestore()
      .collection("crash_id")
      .doc(crashId)
      .get();
    return doc.exists;
  } catch (error) {
    console.error("Error checking crash existence:", error);
    throw new Error("Failed to check crash existence.");
  }
}

// Fungsi untuk menyimpan data crash ke Firestore
async function saveCrashData(
  crashId: string,
  rideguardId: string,
  lat: number,
  long: number
) {
  try {
    const crashData = {
      crash_id: crashId,
      rideguard_id: rideguardId,
      latitude: lat,
      longitude: long,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      created_at: new Date().toISOString(),
    };

    await admin.firestore().collection("crash_id").doc(crashId).set(crashData);
    console.log(`New crash data saved for crash_id: ${crashId}`);
  } catch (error) {
    console.error("Error saving crash data:", error);
    throw new Error("Failed to save crash data.");
  }
}

// Fungsi untuk mendapatkan semua token terkait dengan rideguard_id
async function getTokensForRideguard(rideguardId: string): Promise<string[]> {
  try {
    const db = admin.firestore();
    const tokensSet = new Set<string>();

    // Step 1: Read the rideguard device document to get the username
    const deviceDoc = await db.collection("rideguard_id").doc(rideguardId).get();

    if (!deviceDoc.exists) {
      console.log(`Rideguard device not found: ${rideguardId}`);
      return [];
    }

    const deviceData = deviceDoc.data();
    const rideguardUsername = deviceData?.username || deviceData?.currentUser?.username;

    if (!rideguardUsername || typeof rideguardUsername !== "string") {
      console.log(`No username found for rideguard device: ${rideguardId}`);
      return [];
    }

    console.log(`Found rideguard username: ${rideguardUsername}`);

    // Step 2: Search in users collection for the rideguard username
    const rideguardUserQuery = await db
      .collection("users")
      .where("username", "==", rideguardUsername)
      .limit(1)
      .get();

    if (rideguardUserQuery.empty) {
      console.log(`User not found for username: ${rideguardUsername}`);
      return [];
    }

    const rideguardUserDoc = rideguardUserQuery.docs[0];
    const rideguardUserData = rideguardUserDoc.data();
    console.log(`Found rideguard user document for: ${rideguardUsername}`);

    // Step 3: Read the emergency contacts from the rideguard user document
    const emergencyContacts = Array.isArray(rideguardUserData?.emergencyContacts)
      ? rideguardUserData.emergencyContacts
      : [];

    if (emergencyContacts.length === 0) {
      console.log(`No emergency contacts found for user: ${rideguardUsername}`);
      return [];
    }

    console.log(`Found ${emergencyContacts.length} emergency contact(s) for user: ${rideguardUsername}`);

    // Step 4 & 5: For each emergency contact, search users collection by username and get the token
    for (const contact of emergencyContacts) {
      if (typeof contact !== "object" || contact === null) continue;

      // Get the emergency contact username - try multiple field names
      const contactUsername =
        (contact as any)?.username ||
        (contact as any)?.contactUsername ||
        (contact as any)?.name;

      if (!contactUsername || typeof contactUsername !== "string") {
        console.warn(`Emergency contact missing username:`, contact);
        continue;
      }

      console.log(`Processing emergency contact username: ${contactUsername}`);

      // Search for the emergency contact user by username
      try {
        const contactUserQuery = await db
          .collection("users")
          .where("username", "==", contactUsername)
          .limit(1)
          .get();

        if (contactUserQuery.empty) {
          console.warn(`Emergency contact user not found for username: ${contactUsername}`);
          continue;
        }

        const contactUserData = contactUserQuery.docs[0].data();
        const token = contactUserData?.fcmToken || contactUserData?.token;

        if (token && typeof token === "string" && token.length > 0) {
          tokensSet.add(token);
          console.log(`Added token for emergency contact: ${contactUsername}`);
        } else {
          console.warn(`No token found for emergency contact: ${contactUsername}`);
        }
      } catch (err) {
        console.warn(`Failed to lookup emergency contact ${contactUsername}:`, err);
      }
    }

    const tokens = Array.from(tokensSet);
    console.log(`Retrieved ${tokens.length} tokens for rideguard_id: ${rideguardId}`);
    return tokens;
  } catch (error) {
    console.error("Error getting tokens for rideguard:", error);
    throw new Error("Failed to retrieve tokens.");
  }
}

// Endpoint untuk menerima POST request dan mengembalikan rumah sakit terdekat
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { crash_id, rideguard_id, lat, long } = body;
    console.log(crash_id, rideguard_id, lat, long);

    // Validasi input
    if (
      !crash_id ||
      !rideguard_id ||
      !lat ||
      !long ||
      isNaN(lat) ||
      isNaN(long)
    ) {
      return new NextResponse(
        JSON.stringify({
          error:
            "Valid 'crash_id', 'rideguard_id', 'lat' and 'long' are required",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Periksa apakah crash_id sudah ada di database
    // const crashExists = await checkCrashExists(crash_id);

    // if (crashExists) {
    //   console.log(`⚠️  Crash with ID ${crash_id} has occurred before. Not saving to database, but continuing to process request.`);
    // } else {
    //   // Simpan data crash baru ke Firebase
    //   await saveCrashData(crash_id, rideguard_id, lat, long);
    // }

    // Ambil data rumah sakit dari Firestore
    const hospitals = await getAllHospitals();

    if (hospitals.length === 0) {
      return new NextResponse(JSON.stringify({ error: "No hospitals found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Cari rumah sakit terdeka
    let nearestHospital: Hospital | null = null;
    let minDistance = Infinity;

    hospitals.forEach((hospital) => {
      const { _latitude, _longitude } = hospital.location;
      const distance = haversine(lat, long, _latitude, _longitude);

      if (distance < minDistance) {
        minDistance = distance;
        nearestHospital = hospital;
      }
    });

    if (!nearestHospital || !("name" in nearestHospital)) {
      return new NextResponse(
        JSON.stringify({ error: "No nearest hospital found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Dapatkan semua token terkait dengan rideguard_id
    const tokens = await getTokensForRideguard(rideguard_id);
    console.log(
      `Found ${tokens.length} tokens for rideguard_id: ${rideguard_id}`
    );

    if (tokens.length > 0) {
      console.log(tokens);
      const messages = tokens.map(token => ({
        data: {
          title: "TABRAKAN",
          body: `RideGuard mendeteksi tabrakan, rumah sakit terdekat: ${nearestHospital!.name}`,
        },
        token,
      }));

  await admin.messaging().sendEach(messages);
  console.log(`Notification sent to ${tokens.length} devices for rideguard_id: ${rideguard_id}`);
    } else {
      console.log(`No tokens found for rideguard_id: ${rideguard_id}`);
    }

    // Return hospital terdekat
    return new NextResponse(
      JSON.stringify({ success: true, nearestHospital, distance: minDistance }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new NextResponse(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
