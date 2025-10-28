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
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius bumi dalam kilometer
  const φ1 = lat1 * (Math.PI / 180); // konversi latitude ke radian
  const φ2 = lat2 * (Math.PI / 180); // konversi latitude ke radian
  const Δφ = (lat2 - lat1) * (Math.PI / 180); // selisih latitude
  const Δλ = (lon2 - lon1) * (Math.PI / 180); // selisih longitude

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
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
    const snapshot = await admin.firestore().collection('emergency_services').get();
    const hospitals = snapshot.docs.map(doc => ({
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

// Endpoint untuk menerima POST request dan mengembalikan rumah sakit terdekat
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { crash_id, rideguard_id, lat, long } = body;
    console.log(crash_id, rideguard_id, lat, long);

    // Validasi input
    if (!lat || !long || isNaN(lat) || isNaN(long)) {
      return new NextResponse(JSON.stringify({ error: "Valid 'lat' and 'long' are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

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

    hospitals.forEach(hospital => {
      const { _latitude, _longitude } = hospital.location;
      const distance = haversine(lat, long, _latitude, _longitude);

      if (distance < minDistance) {
        minDistance = distance;
        nearestHospital = hospital;
      }
    });

    if (!nearestHospital || !('name' in nearestHospital)) {
      return new NextResponse(JSON.stringify({ error: "No nearest hospital found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    
    const message = {
      notification: {
        title: "TABRAKAN",
        body: "RideGuard mendeteksi tabrakan, rumah sakit terdekat: " + nearestHospital,
      },
      token: "feepOfx_QGWljPgNZI3I7I:APA91bH8RTVzV5zVysrwwIUQ1wKeu6rQkf9QgKuz6ya8-SNG967UWmjq_5JJFCBYZWtdZ3NlO31ihnu__bV03Nv5a7wASsC8HBfw19mBAs90m57UsRoYqgA"
    };

    // Return hospital terdekat
    return new NextResponse(JSON.stringify({ success: true, nearestHospital, distance: minDistance }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new NextResponse(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
