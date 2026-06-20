import { AccessToken, AccessTokenOptions, VideoGrant } from "livekit-server-sdk";
import { NextResponse } from "next/server";

// NOTE: Environment variables can be defined in `.env.local` or passed from voice-mode config
const API_KEY = process.env.LIVEKIT_API_KEY || "devkey";
const API_SECRET = process.env.LIVEKIT_API_SECRET || "secret";
// Returned to the browser as serverUrl; must be reachable from the phone over WLAN.
// Set LIVEKIT_URL in .env.local, e.g. ws://YOUR_LAN_IP:7880
const LIVEKIT_URL = process.env.LIVEKIT_URL;
// Optional phone access key. When set, the client must present a matching x-access-key header
// (seeded once via a bookmarked ?key=... URL, then remembered in the phone's localStorage).
// When unset/empty the endpoint stays open on the local WLAN — the default, unchanged behaviour.
const ACCESS_KEY = process.env.LIVEKIT_ACCESS_KEY || "";

// don't cache the results
export const revalidate = 0;

export type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

export async function GET(request: Request) {
  try {
    // Phone access gate: when LIVEKIT_ACCESS_KEY is set, the client must send a matching
    // x-access-key header. Unset = open access on the local WLAN (unchanged default).
    if (ACCESS_KEY && request.headers.get("x-access-key") !== ACCESS_KEY) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // These checks are now optional since we have defaults
    // but we can still validate they're not empty strings
    if (!LIVEKIT_URL) {
      throw new Error("LIVEKIT_URL is empty");
    }
    if (!API_KEY) {
      throw new Error("LIVEKIT_API_KEY is empty");
    }
    if (!API_SECRET) {
      throw new Error("LIVEKIT_API_SECRET is empty");
    }

    // Single-conversation model: one phone, one fixed room. The bot joins this
    // same room by name (LIVEKIT_ROOM_NAME, default "voicemode"), so a phone
    // reload rejoins the same room instead of minting a fresh random one.
    const participantIdentity = `voice_assistant_user_${Math.floor(Math.random() * 10_000)}`;
    const roomName = process.env.LIVEKIT_ROOM_NAME || "voicemode";
    const participantToken = await createParticipantToken(
      { identity: participantIdentity },
      roomName
    );

    // Log the URL being used for debugging
    console.log("LIVEKIT_URL from env:", process.env.LIVEKIT_URL);
    console.log("Using LIVEKIT_URL:", LIVEKIT_URL);
    
    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantToken: participantToken,
      participantName: participantIdentity,
    };
    const headers = new Headers({
      "Cache-Control": "no-store",
    });
    return NextResponse.json(data, { headers });
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: "15m",
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);
  return at.toJwt();
}
