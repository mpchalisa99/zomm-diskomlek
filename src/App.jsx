/**
 * ============================================================================
 * FILE FRONTEND: src/App.jsx
 * TACTICAL VIDCOMM DISKOMLEKAU — 100% PRODUCTION WEBRTC LIVEKIT & PWA
 *
 * 5 DOKTRIN OPERASIONAL:
 * 1. LOBBY & SHARE LINK (AWALAN KOSONG):
 *    - State default Callsign/NRP adalah `""` (string kosong). Tombol "GABUNG RAPAT"
 *      disabled jika Callsign belum diisi.
 *    - Tombol "SHARE LINK VTC" di Lobby dan di Control Bar (IN_CALL) menggunakan
 *      Web Share API (`navigator.share`) di HP dengan fallback `navigator.clipboard.writeText`
 *      di Desktop.
 * 2. SMART GRID 4 KOTAK (PRIORITAS SUARA & SCREEN SHARE):
 *    - Custom Layout Grid tanpa `<VideoConference />` bawaan.
 *    - Menggunakan `useParticipants()` dan mengurutkan otomatis dengan prioritas:
 *      (1) Peserta yang sedang Share Screen, (2) Active Speaker (`isSpeaking`),
 *      (3) Peserta diam.
 *    - Pagination (Tombol Geser Prev/Next transparan) membatasi maksimal 4 kotak
 *      (`grid-cols-2 grid-rows-2`) per halaman.
 * 3. OVERLAY HUD TAKTIS (IDENTITAS & GPS TRANSPARAN):
 *    - Saat masuk `IN_CALL`, mengeksekusi `navigator.geolocation.getCurrentPosition()`
 *      dan Reverse Geocoding ke Nominatim OpenStreetMap (`https://nominatim.openstreetmap.org/reverse`).
 *    - Menyimpan & menyebarkan ke metadata LiveKit:
 *      `localParticipant.setMetadata(JSON.stringify({ callsign, lat, lng, location }))`.
 *    - Komponen `<CustomParticipantTile />` merender overlay:
 *      `absolute bottom-1 left-1 right-1 z-50 bg-black/50 backdrop-blur-sm text-white text-[9px] md:text-[11px] p-1 font-mono rounded`
 *      dengan format: "CALLSIGN | LAT,LNG | NAMA LOKASI".
 * 4. FITUR UBAH NAMA DI TENGAH RAPAT:
 *    - Tombol "UBAH SANDI/NAMA" di Custom Control Bar mengeksekusi perubahan nama
 *      secara real-time ke seluruh klien via `localParticipant.updateName(newName)` /
 *      `localParticipant.setName(newName)` dan `localParticipant.setMetadata(...)`.
 * 5. PENYESUAIAN CONTROL BAR:
 *    - Menyembunyikan tombol "Share Screen" jika dibuka di Mobile, dan menampilkannya
 *      hanya di Desktop.
 *    - Tombol Switch Camera (Pindah Kamera Depan/Belakang) memanfaatkan video track
 *      (`restartTrack` & `room.switchActiveDevice`).
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  ConnectionQualityIndicator,
  TrackToggle,
  useTracks,
  useConnectionState,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
  useParticipantInfo,
  useChat,
  ParticipantContextIfNeeded,
} from '@livekit/components-react';
import { ConnectionState, ConnectionQuality, Track } from 'livekit-client';
import '@livekit/components-styles';
import {
  Shield,
  Radio,
  Lock,
  Users,
  PhoneOff,
  AlertTriangle,
  SlidersHorizontal,
  Wifi,
  WifiOff,
  QrCode,
  X,
  ZapOff,
  Zap,
  MessageSquare,
  Send,
  Copy,
  Check,
  KeyRound,
  UserCheck,
  RefreshCw,
  Download,
  Smartphone,
  SwitchCamera,
  MapPin,
  Edit3,
  Share2,
  ChevronLeft,
  ChevronRight,
  Volume2,
  MonitorUp,
} from 'lucide-react';

// 1. DOKTRIN 1: State Default Callsign/NRP wajib "" (string kosong)
const DEFAULT_CALLSIGN = '';
const DEFAULT_ROOM_NAME = 'yes';
const DEFAULT_SANDI = 'yes';
const MAX_TILES_PER_PAGE = 4;

const LOGO_DISKOMLEKAU_SRC = '/assets/aistudio/1794622160588-picsay_109de27f.png';
const LOGO_TNI_AU_SRC = '/assets/aistudio/1792503945296_954409ac.jpg';

/**
 * Generator Callsign Acak Otomatis untuk Prajurit yang Join via Deep Link QR
 */
function generateRandomCallsign() {
  const randomNumber = Math.floor(10 + Math.random() * 90);
  return `PERSONEL-${randomNumber}`;
}

/**
 * Helper Ekstraksi Metadata JSON dari Participant LiveKit
 */
function parseParticipantMetadata(participant) {
  if (!participant?.metadata) return null;
  try {
    const parsed = JSON.parse(participant.metadata);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Abaikan jika bukan JSON valid
  }
  return null;
}

/**
 * ============================================================================
 * HOOK DETEKSI PERANGKAT MOBILE VS DESKTOP (DOKTRIN 5)
 * Menyembunyikan Share Screen pada perangkat Mobile agar tidak memicu error OS
 * ============================================================================
 */
function useIsMobileDevice() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent || '';
    const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
    return mobileRegex.test(ua) || window.innerWidth <= 768;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      const ua = window.navigator.userAgent || '';
      const mobileRegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;
      setIsMobile(mobileRegex.test(ua) || window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

/**
 * ============================================================================
 * HOOK GEOLOCATION & REVERSE GEOCODING NOMINATIM OPENSTREETMAP (DOKTRIN 3)
 * Mengeksekusi `navigator.geolocation.getCurrentPosition()` dan mengambil
 * nama "Kecamatan/Kota" dari `https://nominatim.openstreetmap.org/reverse`
 * ============================================================================
 */
function useTacticalGpsLocation() {
  const [gpsState, setGpsState] = useState({
    available: false,
    status: 'MENCARI GPS...',
    lat: null,
    lng: null,
    latLngText: '',
    location: '',
  });

  const lastGeocodeRef = useRef({ lat: null, lng: null });

  const fetchNominatimLocation = useCallback(async (lat, lng) => {
    if (
      lastGeocodeRef.current.lat !== null &&
      Math.abs(lastGeocodeRef.current.lat - lat) < 0.001 &&
      Math.abs(lastGeocodeRef.current.lng - lng) < 0.001
    ) {
      return;
    }
    lastGeocodeRef.current = { lat, lng };

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1&accept-language=id`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (response.ok) {
        const data = await response.json();
        const addr = data?.address || {};

        const rawKecamatan =
          addr.suburb ||
          addr.city_district ||
          addr.municipality ||
          addr.town ||
          addr.village ||
          addr.neighbourhood ||
          '';
        const rawKotaKab =
          addr.city ||
          addr.county ||
          addr.regency ||
          addr.state_district ||
          addr.state ||
          '';

        const cleanKec = rawKecamatan.replace(/^(Kecamatan|Kec\.)\s+/i, '').trim();
        const formattedKec = cleanKec ? `Kec. ${cleanKec}` : '';
        const cleanKota = rawKotaKab.trim();

        const parts = [formattedKec, cleanKota].filter(Boolean);
        const uniqueParts = parts.filter((item, index) => parts.indexOf(item) === index);
        const locationName = uniqueParts.join(', ');

        if (locationName) {
          setGpsState((prev) => ({
            ...prev,
            location: locationName,
          }));
          return;
        }
      }
    } catch {
      // Fallback jika Nominatim sedang sibuk
    }

    try {
      const fbRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=id`
      );
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        const rawKec = (fbData.locality || '').replace(/^(Kecamatan|Kec\.)\s+/i, '').trim();
        const formattedKec = rawKec ? `Kec. ${rawKec}` : '';
        const kota = (fbData.city || fbData.principalSubdivision || '').trim();
        const parts = [formattedKec, kota].filter(Boolean);
        const uniqueParts = parts.filter((item, index) => parts.indexOf(item) === index);
        const locationName = uniqueParts.join(', ');

        if (locationName) {
          setGpsState((prev) => ({
            ...prev,
            location: locationName,
          }));
        }
      }
    } catch {
      // Tetap tampilkan koordinat jika perangkat offline
    }
  }, []);

  const triggerGetCurrentPosition = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsState((prev) => ({
        ...prev,
        available: false,
        status: 'GPS TIDAK TERSEDIA',
      }));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const formattedCoord = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

        setGpsState((prev) => ({
          ...prev,
          available: true,
          status: 'GPS LOCKED',
          lat: latitude,
          lng: longitude,
          latLngText: formattedCoord,
        }));

        fetchNominatimLocation(latitude, longitude);
      },
      (err) => {
        setGpsState((prev) => ({
          ...prev,
          available: false,
          status: err.code === 1 ? 'IZIN GPS DITOLAK' : 'GPS STANDBY',
        }));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      }
    );
  }, [fetchNominatimLocation]);

  useEffect(() => {
    triggerGetCurrentPosition();

    if (typeof window === 'undefined' || !('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const formattedCoord = `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

        setGpsState((prev) => ({
          ...prev,
          available: true,
          status: 'GPS LOCKED',
          lat: latitude,
          lng: longitude,
          latLngText: formattedCoord,
        }));

        fetchNominatimLocation(latitude, longitude);
      },
      () => {},
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [triggerGetCurrentPosition, fetchNominatimLocation]);

  return {
    ...gpsState,
    refreshGps: triggerGetCurrentPosition,
  };
}

/**
 * ============================================================================
 * HOOK: PWA INSTALL PROMPT (`beforeinstallprompt` & Standalone Detector)
 * ============================================================================
 */
function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsInstalled(isStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(ua));

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const triggerInstall = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: !!deferredPrompt,
    isInstalled,
    isIOS,
    triggerInstall,
  };
}

function PWAInstallButton({ compact = false }) {
  const { isInstallable, isInstalled, isIOS, triggerInstall } = usePWAInstall();
  const [showGuideModal, setShowGuideModal] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      await triggerInstall();
    } else {
      setShowGuideModal(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`rounded-lg bg-cyan-400/20 hover:bg-cyan-400/30 border border-cyan-300/60 text-cyan-200 font-bold tracking-wider uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 ${
          compact ? 'px-2 py-1 text-[10px] sm:text-xs' : 'px-3 py-1.5 text-xs'
        }`}
        title="Install TACTICAL VIDCOMM ke Layar Utama HP"
      >
        <Download className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
        <span className="hidden sm:inline">{compact ? 'INSTALL' : 'INSTALL PWA'}</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-sky-300/50 rounded-2xl p-5 shadow-[0_0_40px_rgba(56,189,248,0.25)] text-left space-y-3.5">
            <div className="flex items-center justify-between border-b border-sky-300/25 pb-2.5">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-cyan-300" />
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-sky-300 uppercase">
                    INSTALL VIDCOMM KE LAYAR HP
                  </h3>
                  <p className="text-[10px] text-cyan-300">
                    MODE STANDALONE FULLSCREEN
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                className="p-1 rounded-lg bg-blue-950 border border-sky-300/30 text-sky-300 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="space-y-2 text-xs text-sky-100 leading-relaxed">
                <p className="font-bold text-cyan-300">Panduan iPhone / iPad (Safari):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>Ketuk ikon <strong>Share (Bagikan)</strong> di Safari.</li>
                  <li>Pilih <strong>&quot;Add to Home Screen&quot;</strong>.</li>
                  <li>Ketuk <strong>Add (Tambah)</strong> di pojok kanan atas.</li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2 text-xs text-sky-100 leading-relaxed">
                <p className="font-bold text-cyan-300">Panduan Android (Chrome / Edge):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>Buka URL aplikasi ini di tab utama <strong>Google Chrome</strong>.</li>
                  <li>Ketuk ikon menu <strong>Titik Tiga (⋮)</strong> di pojok kanan atas.</li>
                  <li>Pilih <strong>&quot;Install App&quot; / &quot;Tambahkan ke Layar Utama&quot;</strong>.</li>
                </ol>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="w-full py-2.5 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-xs tracking-wider uppercase cursor-pointer"
            >
              MENGERTI
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Komponen Logo Resmi DISKOMLEKAU & TNI AU (Ukuran & Dimensi Seragam)
 */
function TacticalRadarLogo({ className = 'w-9 h-9' }) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-lg border border-sky-300/40 bg-blue-950/80 overflow-hidden shadow-[0_0_15px_rgba(56,189,248,0.15)] shrink-0 ${className}`}
    >
      <img
        src={LOGO_DISKOMLEKAU_SRC}
        alt="Logo DISKOMLEKAU"
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover"
      />
    </div>
  );
}

function TniAuLogo({ className = 'w-9 h-9' }) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-lg border border-amber-400/60 bg-slate-950 overflow-hidden shadow-[0_0_15px_rgba(251,191,36,0.2)] shrink-0 ${className}`}
      title="TNI Angkatan Udara — Swa Bhuwana Paksa"
    >
      <img
        src={LOGO_TNI_AU_SRC}
        alt="Logo TNI AU Swa Bhuwana Paksa"
        referrerPolicy="no-referrer"
        className="w-full h-full object-cover"
      />
    </div>
  );
}

/**
 * ============================================================================
 * DOKTRIN 3: KOMPONEN WRAPPER <CustomParticipantTile />
 * Merender video peserta beserta Overlay HUD Taktis:
 * `absolute bottom-1 left-1 right-1 z-50 bg-black/50 backdrop-blur-sm text-white text-[9px] md:text-[11px] p-1 font-mono rounded`
 * Format isi overlay: "CALLSIGN | LAT,LNG | NAMA LOKASI"
 * ============================================================================
 */
function CustomParticipantTile({ trackRef, participant, localGps, localCallsign }) {
  const targetParticipant = trackRef?.participant || participant;
  const participantInfo = useParticipantInfo({ participant: targetParticipant });

  const meta = parseParticipantMetadata(targetParticipant);
  const isLocal = Boolean(targetParticipant?.isLocal);
  const isScreenShare = trackRef?.source === Track.Source.ScreenShare;

  // 1. CALLSIGN
  const rawCallsign =
    meta?.callsign ||
    participantInfo?.name ||
    targetParticipant?.name ||
    (isLocal ? localCallsign : '') ||
    participantInfo?.identity ||
    targetParticipant?.identity ||
    'PERSONEL';
  const callsignText = String(rawCallsign).split('\n')[0].trim().toUpperCase();

  // 2. LAT,LNG
  let latLngText = 'GPS-STANDBY';
  if (
    isLocal &&
    localGps?.available &&
    typeof localGps.lat === 'number' &&
    typeof localGps.lng === 'number'
  ) {
    latLngText = `${localGps.lat.toFixed(5)},${localGps.lng.toFixed(5)}`;
  } else if (meta && typeof meta.lat === 'number' && typeof meta.lng === 'number') {
    latLngText = `${Number(meta.lat).toFixed(5)},${Number(meta.lng).toFixed(5)}`;
  } else if (meta?.latLng) {
    latLngText = String(meta.latLng).replace(/\s+/g, '');
  }

  // 3. NAMA LOKASI
  const locationText = isLocal
    ? localGps?.location ||
      meta?.location ||
      (localGps?.available ? 'MENDETEKSI LOKASI...' : localGps?.status || 'LOKASI-OFF')
    : meta?.location || meta?.region || 'LOKASI-TIDAK-TERSEDIA';

  const overlayString = `${callsignText}${
    isScreenShare ? ' [PRESENTASI]' : ''
  } | ${latLngText} | ${locationText}`;

  return (
    <div className="tactical-tile-container relative w-full h-full min-h-[120px] overflow-hidden rounded-[10px]">
      {trackRef && (
        <ParticipantTile
          trackRef={trackRef}
          className="!h-full !w-full"
        />
      )}

      {/* Badge Indikator Prioritas di Pojok Kiri Atas Tile */}
      <div className="pointer-events-none absolute top-1.5 left-1.5 z-40 flex items-center gap-1">
        {isScreenShare && (
          <span className="px-1.5 py-0.5 rounded bg-cyan-400/90 text-slate-950 font-mono font-bold text-[8px] md:text-[10px] uppercase flex items-center gap-1 shadow">
            <MonitorUp className="w-3 h-3" />
            <span>SHARE SCREEN</span>
          </span>
        )}
        {targetParticipant?.isSpeaking && !isScreenShare && (
          <span className="px-1.5 py-0.5 rounded bg-sky-400/90 text-slate-950 font-mono font-bold text-[8px] md:text-[10px] uppercase flex items-center gap-1 shadow">
            <Volume2 className="w-3 h-3" />
            <span>ACTIVE SPEAKER</span>
          </span>
        )}
      </div>

      {/* OVERLAY HUD TAKTIS SESUAI DOKTRIN 3 */}
      <div className="absolute bottom-1 left-1 right-1 z-50 bg-black/50 backdrop-blur-sm text-white text-[9px] md:text-[11px] p-1 font-mono rounded pointer-events-none flex items-center justify-between gap-1.5">
        <span className="truncate font-semibold tracking-tight">
          {overlayString}
        </span>

        {targetParticipant && (
          <ParticipantContextIfNeeded participant={targetParticipant}>
            <ConnectionQualityIndicator className="!p-0 !bg-transparent shrink-0" />
          </ParticipantContextIfNeeded>
        )}
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * HEADER HUD ATAS SAAT IN_CALL
 * ============================================================================
 */
function LiveKitHeaderHUD({
  roomName,
  participantName,
  lowBandwidthMode,
  localGps,
  onOpenQrModal,
}) {
  const connectionState = useConnectionState();
  const participants = useParticipants();
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();

  const stateBadgeConfig = {
    [ConnectionState.Connected]: {
      label: 'CONNECTED',
      badgeClass: 'border-sky-300/50 bg-blue-950/90 text-sky-200',
      dotClass: 'bg-sky-400',
      icon: Wifi,
    },
    [ConnectionState.Connecting]: {
      label: 'CONNECTING...',
      badgeClass: 'border-blue-400/50 bg-blue-950/80 text-blue-200',
      dotClass: 'bg-blue-400',
      icon: RefreshCw,
    },
    [ConnectionState.Reconnecting]: {
      label: 'RECONNECTING',
      badgeClass: 'border-amber-400/60 bg-amber-950/80 text-amber-200',
      dotClass: 'bg-amber-400',
      icon: AlertTriangle,
    },
    [ConnectionState.Disconnected]: {
      label: 'DISCONNECTED',
      badgeClass: 'border-red-400/60 bg-red-950/80 text-red-200',
      dotClass: 'bg-red-400',
      icon: WifiOff,
    },
  }[connectionState] || {
    label: String(connectionState).toUpperCase(),
    badgeClass: 'border-sky-300/40 bg-slate-900 text-sky-300',
    dotClass: 'bg-sky-300',
    icon: Wifi,
  };

  const StatusIcon = stateBadgeConfig.icon;

  return (
    <header className="shrink-0 bg-slate-900/95 border-b border-sky-300/30 px-3 py-2 sm:px-5 flex flex-wrap items-center justify-between gap-2 z-30">
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <TacticalRadarLogo className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xs sm:text-sm md:text-base font-bold tracking-wider text-sky-300 truncate">
              TACTICAL VIDCOMM DISKOMLEKAU
            </h1>
            <TniAuLogo className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" />

            {isScreenShareEnabled && (
              <span className="px-2 py-0.5 rounded bg-cyan-400/20 border border-cyan-300/60 text-[10px] font-bold text-cyan-300 tracking-wider uppercase shrink-0">
                PRESENTING
              </span>
            )}
            {lowBandwidthMode && (
              <span className="px-2 py-0.5 rounded bg-amber-950/90 border border-amber-400/60 text-[10px] font-bold text-amber-300 tracking-wider uppercase shrink-0">
                VOICE-ONLY
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] sm:text-xs text-slate-300">
            <span className="text-sky-300 font-semibold">ROOM: {roomName}</span>
            <span className="text-blue-400">·</span>
            <span className="text-cyan-300 font-semibold">CALLSIGN: {participantName}</span>
            {localGps?.available && localGps.latLngText && (
              <>
                <span className="text-blue-400 hidden md:inline">·</span>
                <span className="hidden md:inline-flex items-center gap-1 text-sky-200 font-mono text-[10px]">
                  <MapPin className="w-3 h-3 text-cyan-300 shrink-0" />
                  <span>{localGps.latLngText}</span>
                  {localGps.location && (
                    <span className="text-cyan-300">({localGps.location})</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto shrink-0">
        <PWAInstallButton compact={true} />

        {localParticipant && (
          <ParticipantContextIfNeeded participant={localParticipant}>
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/80 border border-sky-300/30 text-xs"
              title="Kualitas Sinyal WebRTC Real-time Anda"
            >
              <ConnectionQualityIndicator className="!p-0 !bg-transparent" />
              <span className="hidden md:inline text-[11px] font-semibold text-sky-300 uppercase">
                {localParticipant.connectionQuality === ConnectionQuality.Excellent
                  ? 'EXCELLENT'
                  : localParticipant.connectionQuality === ConnectionQuality.Good
                  ? 'GOOD'
                  : localParticipant.connectionQuality === ConnectionQuality.Poor
                  ? 'POOR'
                  : localParticipant.connectionQuality === ConnectionQuality.Lost
                  ? 'LOST'
                  : 'SIGNAL'}
              </span>
            </div>
          </ParticipantContextIfNeeded>
        )}

        <div
          className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/80 border border-sky-300/30 text-xs text-sky-200"
          title="Jumlah Personel Terhubung"
        >
          <Users className="w-3.5 h-3.5 text-sky-300" />
          <span className="font-bold">{participants.length}</span>
          <span className="hidden lg:inline text-sky-300/80 text-[10px]">NODES</span>
        </div>

        <div
          className={`px-2.5 py-1 rounded-lg border text-[10px] sm:text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 ${stateBadgeConfig.badgeClass}`}
        >
          <span className={`w-2 h-2 rounded-full ${stateBadgeConfig.dotClass}`} />
          <StatusIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline">{stateBadgeConfig.label}</span>
        </div>

        <button
          type="button"
          onClick={onOpenQrModal}
          className="p-1.5 sm:px-2.5 sm:py-1 rounded-lg bg-sky-400/15 hover:bg-sky-400/25 border border-sky-300/40 text-sky-200 flex items-center gap-1.5 text-xs font-bold transition-colors cursor-pointer"
          title="Tampilkan QR Undangan Deep Link"
        >
          <QrCode className="w-4 h-4 text-sky-300" />
          <span className="hidden md:inline">QR</span>
        </button>
      </div>
    </header>
  );
}

/**
 * ============================================================================
 * DOKTRIN 4: MODAL FALLBACK UBAH NAMA DI TENGAH RAPAT
 * Digunakan jika `window.prompt` diblokir oleh kebijakan sandbox iframe browser
 * ============================================================================
 */
function RenamePromptModal({ isOpen, onClose, currentName, onConfirmRename }) {
  const [nameValue, setNameValue] = useState(currentName || '');

  useEffect(() => {
    if (isOpen) {
      setNameValue(currentName || '');
    }
  }, [isOpen, currentName]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const clean = nameValue.trim();
    if (!clean) return;
    onConfirmRename(clean);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-slate-900 border border-sky-300/50 rounded-2xl p-5 shadow-[0_0_40px_rgba(56,189,248,0.25)] space-y-4">
        <div className="flex items-center justify-between border-b border-sky-300/25 pb-2.5">
          <div className="flex items-center gap-2">
            <Edit3 className="w-4 h-4 text-cyan-300" />
            <div>
              <h3 className="text-xs sm:text-sm font-bold text-sky-300 tracking-wider uppercase">
                UBAH SANDI / NAMA PERSONEL
              </h3>
              <p className="text-[10px] text-cyan-300">
                UPDATE REAL-TIME KE SELURUH KLIEN
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-blue-950 border border-sky-300/30 text-sky-300 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label
              htmlFor="rename-callsign-input"
              className="block text-xs font-bold uppercase tracking-wider text-sky-300 mb-1"
            >
              MASUKKAN CALLSIGN / NAMA BARU
            </label>
            <input
              id="rename-callsign-input"
              type="text"
              required
              autoFocus
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/85 border border-sky-300/50 rounded-lg text-sky-100 focus:outline-none focus:border-cyan-300"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="py-2.5 px-3 rounded-xl bg-blue-950 hover:bg-slate-800 text-sky-300 border border-sky-300/40 text-xs font-bold tracking-wider uppercase cursor-pointer"
            >
              BATAL
            </button>
            <button
              type="submit"
              disabled={!nameValue.trim()}
              className="py-2.5 px-3 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-slate-950 font-bold text-xs tracking-wider uppercase cursor-pointer"
            >
              UBAH NAMA
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * KOMPONEN REAL-TIME CHAT PANEL (WEBRTC DATA CHANNEL)
 * ============================================================================
 */
function RealTimeChatOverlay({ isOpen, onClose, localCallsign, onUnreadChange }) {
  const { chatMessages, send, isSending } = useChat();
  const [inputMessage, setInputMessage] = useState('');
  const messagesEndRef = useRef(null);
  const lastSeenCountRef = useRef(0);

  useEffect(() => {
    if (isOpen) {
      lastSeenCountRef.current = chatMessages.length;
      onUnreadChange(0);
    } else {
      const unread = Math.max(0, chatMessages.length - lastSeenCountRef.current);
      onUnreadChange(unread);
    }
  }, [chatMessages.length, isOpen, onUnreadChange]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages.length, isOpen]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    const text = inputMessage.trim();
    if (!text || isSending) return;
    try {
      await send(text);
      setInputMessage('');
    } catch (err) {
      console.error('Gagal mengirim pesan chat Data Channel:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="absolute top-2 right-2 bottom-2 z-50 w-[calc(100%-1rem)] sm:w-88 md:w-96 bg-slate-900/95 backdrop-blur-md border border-sky-300/40 rounded-xl shadow-[0_0_35px_rgba(2,6,23,0.85)] flex flex-col overflow-hidden">
      <div className="shrink-0 px-4 py-3 bg-blue-950/90 border-b border-sky-300/30 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-sky-300" />
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-sky-300 tracking-wider uppercase">
              CHAT KORESPONDENSI TAKTIS
            </h3>
            <p className="text-[10px] text-cyan-300/80">
              WEBRTC DATA CHANNEL · REAL-TIME
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-sky-300/30 text-sky-200 cursor-pointer"
          title="Tutup Chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-2.5">
        {chatMessages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-slate-400">
            <MessageSquare className="w-8 h-8 text-sky-300/40 mb-2" />
            <p className="text-xs font-bold text-sky-200">
              Belum Ada Pesan Korespondensi
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              Kirim instruksi atau koordinat rapat secara real-time ke seluruh personel di room ini.
            </p>
          </div>
        ) : (
          chatMessages.map((msg, idx) => {
            const metaSender = parseParticipantMetadata(msg.from);
            const sender =
              metaSender?.callsign || msg.from?.name || msg.from?.identity || 'PERSONEL';
            const isSelf =
              msg.from?.isLocal ||
              sender.toUpperCase() === String(localCallsign).toUpperCase();
            const timeStr = new Date(msg.timestamp).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <div
                key={msg.id || `${msg.timestamp}-${idx}`}
                className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 mb-1 px-1">
                  <span className="text-[10px] font-bold tracking-wider uppercase text-sky-300">
                    {isSelf ? `${sender} (ANDA)` : sender}
                  </span>
                  <span className="text-[9px] text-slate-400">{timeStr}</span>
                </div>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed break-words ${
                    isSelf
                      ? 'bg-sky-400/20 border border-sky-300/50 text-sky-100'
                      : 'bg-blue-950/90 border border-blue-400/35 text-slate-100'
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSendMessage}
        className="shrink-0 p-3 bg-blue-950/90 border-t border-sky-300/30 flex items-center gap-2"
      >
        <input
          type="text"
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          placeholder="Ketik pesan rapat koordinasi..."
          className="flex-1 px-3 py-2 rounded-lg bg-slate-900 border border-sky-300/40 text-xs text-sky-100 placeholder-slate-400 focus:outline-none focus:border-cyan-300"
        />
        <button
          type="submit"
          disabled={!inputMessage.trim() || isSending}
          className="px-3.5 py-2 rounded-lg bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-slate-950 font-bold text-xs tracking-wider uppercase flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>KIRIM</span>
        </button>
      </form>
    </aside>
  );
}

/**
 * ============================================================================
 * MODAL DAFTAR PERSONEL AKTIF & TELEMETRI GPS
 * ============================================================================
 */
function RealTimeParticipantsModal({ isOpen, onClose, roomName, localGps, localCallsign }) {
  const participants = useParticipants();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-lg max-h-[82dvh] bg-slate-900 border border-sky-300/45 rounded-xl shadow-[0_0_40px_rgba(56,189,248,0.25)] flex flex-col overflow-hidden">
        <div className="px-4 py-3 bg-blue-950/90 border-b border-sky-300/30 flex items-center justify-between">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-sky-300 tracking-wider uppercase">
              DAFTAR PERSONEL & POSISI GPS ({participants.length})
            </h3>
            <p className="text-[10px] text-cyan-300/80">
              ROOM: {roomName} · PRIORITAS SHARE SCREEN & ACTIVE SPEAKER
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-900 border border-sky-300/30 text-sky-200 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
          {participants.map((p) => {
            const meta = parseParticipantMetadata(p);
            const latLngCoord = p.isLocal
              ? localGps?.latLngText || meta?.latLng
              : meta?.latLng ||
                (typeof meta?.lat === 'number' && typeof meta?.lng === 'number'
                  ? `${Number(meta.lat).toFixed(5)},${Number(meta.lng).toFixed(5)}`
                  : '');
            const regionText = p.isLocal
              ? localGps?.location || meta?.location
              : meta?.location || meta?.region;
            const displayCallsign =
              meta?.callsign || p.name || (p.isLocal ? localCallsign : '') || p.identity;

            return (
              <ParticipantContextIfNeeded key={p.identity} participant={p}>
                <div className="flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-lg bg-blue-950/60 border border-sky-300/30">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <UserCheck className="w-4 h-4 text-sky-300 shrink-0 mt-0.5" />
                    <div className="min-w-0 space-y-0.5">
                      <p className="text-xs font-bold text-sky-100 truncate">
                        {displayCallsign} {p.isLocal ? '(ANDA)' : ''}
                      </p>
                      <p className="text-[10px] text-cyan-300/80">
                        {p.isScreenShareEnabled
                          ? 'PRIORITAS 1: SEDANG SHARE SCREEN'
                          : p.isSpeaking
                          ? 'PRIORITAS 2: ACTIVE SPEAKER'
                          : 'PRIORITAS 3: STANDBY'}
                      </p>

                      {latLngCoord ? (
                        <div className="pt-1 text-[10px] font-mono text-sky-200 space-y-0.5">
                          <div className="flex items-center gap-1 text-cyan-300 font-bold">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span>{latLngCoord}</span>
                          </div>
                          {regionText && (
                            <div className="text-sky-300/90 pl-4">{regionText}</div>
                          )}
                        </div>
                      ) : (
                        <p className="text-[10px] text-slate-400 italic pt-0.5">
                          GPS Standby / belum diizinkan
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 px-2 py-1 rounded bg-slate-900 border border-sky-300/30 shrink-0">
                    <ConnectionQualityIndicator />
                  </div>
                </div>
              </ParticipantContextIfNeeded>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * WORKSPACE UTAMA DI DALAM <LiveKitRoom> (STATE: IN_CALL)
 * Mengimplementasikan Doktrin 1, 2, 3, 4, dan 5 secara terpadu
 * ============================================================================
 */
function InCallWorkspace({
  roomName,
  participantName,
  onUpdateParticipantName,
  lowBandwidthMode,
  localGps,
  onToggleLowBandwidth,
  onLeave,
  onOpenQrModal,
  onShareVtcLink,
  shareLinkStatus,
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const connectionState = useConnectionState();
  const isMobileDevice = useIsMobileDevice();

  // Ambil seluruh track Camera (dengan placeholder) dan ScreenShare aktif
  const allTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  // State Pagination untuk Smart Grid 4 Kotak (Doktrin 2)
  const [currentPage, setCurrentPage] = useState(0);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);

  // State Switch Camera Depan/Belakang (Doktrin 5)
  const [activeCameraId, setActiveCameraId] = useState('');
  const [cameraFacingMode, setCameraFacingMode] = useState('user');
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);

  // DOKTRIN 3: Saat masuk IN_CALL, eksekusi `navigator.geolocation.getCurrentPosition()`
  useEffect(() => {
    if (localGps?.refreshGps) {
      localGps.refreshGps();
    }
  }, [localGps?.refreshGps]);

  // DOKTRIN 3: Simpan & sebarkan { callsign, lat, lng, location } menggunakan `localParticipant.setMetadata`
  useEffect(() => {
    if (!localParticipant || connectionState !== ConnectionState.Connected) {
      return;
    }

    const payloadObj = {
      callsign: participantName,
      lat:
        localGps?.available && typeof localGps.lat === 'number'
          ? localGps.lat
          : null,
      lng:
        localGps?.available && typeof localGps.lng === 'number'
          ? localGps.lng
          : null,
      latLng: localGps?.latLngText || '',
      location: localGps?.location || '',
    };

    const metadataString = JSON.stringify(payloadObj);

    const publishMetadata = async () => {
      try {
        if (
          typeof localParticipant.setMetadata === 'function' &&
          localParticipant.metadata !== metadataString
        ) {
          await localParticipant.setMetadata(metadataString);
        }

        if (
          typeof localParticipant.setName === 'function' &&
          localParticipant.name !== participantName
        ) {
          await localParticipant.setName(participantName);
        }
      } catch (err) {
        console.warn('Sinkronisasi metadata LiveKit tertunda:', err);
      }
    };

    publishMetadata();
  }, [
    localParticipant,
    connectionState,
    participantName,
    localGps?.available,
    localGps?.lat,
    localGps?.lng,
    localGps?.latLngText,
    localGps?.location,
  ]);

  // Sinkronisasi Mode Hemat Bandwidth
  useEffect(() => {
    if (!room) return;
    try {
      room.localParticipant?.setCameraEnabled(!lowBandwidthMode);
      room.remoteParticipants?.forEach((p) => {
        p.videoTrackPublications?.forEach((pub) => {
          if (typeof pub.setEnabled === 'function') {
            pub.setEnabled(!lowBandwidthMode);
          }
        });
      });
    } catch (err) {
      console.warn('Gagal mengatur mode hemat bandwidth:', err);
    }
  }, [room, lowBandwidthMode]);

  /**
   * ============================================================================
   * DOKTRIN 2: SMART GRID 4 KOTAK (PRIORITAS SUARA & SCREEN SHARE)
   * Menggunakan `useParticipants()` dan mengurutkan (sort) otomatis dengan prioritas:
   * (1) Peserta yang sedang Share Screen berada di urutan paling atas/pertama
   * (2) Active Speaker (peserta yang sedang bersuara) berada di urutan berikutnya
   * (3) Peserta diam berada di urutan terakhir
   * ============================================================================
   */
  const sortedGridItems = useMemo(() => {
    // Urutkan daftar peserta dari useParticipants() sesuai Doktrin 2
    const sortedParticipants = [...participants].sort((a, b) => {
      // Prioritas 1: Peserta yang sedang Share Screen
      const aScreen = Boolean(a.isScreenShareEnabled);
      const bScreen = Boolean(b.isScreenShareEnabled);
      if (aScreen !== bScreen) {
        return aScreen ? -1 : 1;
      }

      // Prioritas 2: Active Speaker (peserta yang sedang bersuara)
      const aSpeaking = Boolean(a.isSpeaking);
      const bSpeaking = Boolean(b.isSpeaking);
      if (aSpeaking !== bSpeaking) {
        return aSpeaking ? -1 : 1;
      }

      // Jika sama-sama berbicara atau diam, utamakan yang terakhir berbicara
      const aLastSpoke = a.lastSpokeAt ? a.lastSpokeAt.getTime() : 0;
      const bLastSpoke = b.lastSpokeAt ? b.lastSpokeAt.getTime() : 0;
      if (aLastSpoke !== bLastSpoke) {
        return bLastSpoke - aLastSpoke;
      }

      return String(a.identity).localeCompare(String(b.identity));
    });

    const items = [];

    // Masukkan tile ScreenShare terlebih dahulu jika ada peserta yang sedang Share Screen
    sortedParticipants.forEach((p) => {
      const screenTrackRef = allTracks.find(
        (t) =>
          t.participant?.identity === p.identity &&
          t.source === Track.Source.ScreenShare
      );
      if (screenTrackRef) {
        items.push({
          key: `${p.identity}-screenshare`,
          participant: p,
          trackRef: screenTrackRef,
        });
      }
    });

    // Selanjutnya masukkan tile Camera masing-masing peserta sesuai urutan prioritas
    sortedParticipants.forEach((p) => {
      const camTrackRef = allTracks.find(
        (t) =>
          t.participant?.identity === p.identity &&
          t.source === Track.Source.Camera
      );

      if (camTrackRef) {
        items.push({
          key: `${p.identity}-camera`,
          participant: p,
          trackRef: camTrackRef,
        });
      } else {
        items.push({
          key: `${p.identity}-placeholder`,
          participant: p,
          trackRef: {
            participant: p,
            source: Track.Source.Camera,
          },
        });
      }
    });

    return items;
  }, [participants, allTracks]);

  const totalPages = Math.max(1, Math.ceil(sortedGridItems.length / MAX_TILES_PER_PAGE));

  useEffect(() => {
    if (currentPage >= totalPages) {
      setCurrentPage(Math.max(0, totalPages - 1));
    }
  }, [currentPage, totalPages]);

  const visibleGridItems = useMemo(() => {
    const startIndex = currentPage * MAX_TILES_PER_PAGE;
    return sortedGridItems.slice(startIndex, startIndex + MAX_TILES_PER_PAGE);
  }, [sortedGridItems, currentPage]);

  /**
   * ============================================================================
   * DOKTRIN 4: FITUR UBAH NAMA DI TENGAH RAPAT
   * Mengeksekusi `window.prompt` (dengan fallback modal jika iframe memblokir prompt)
   * lalu memanggil `localParticipant.updateName(newName)` / `setName` & `setMetadata`
   * ============================================================================
   */
  const executeParticipantRename = useCallback(
    async (rawNewName) => {
      const cleanNewName = String(rawNewName || '').trim();
      if (!cleanNewName) return;

      onUpdateParticipantName(cleanNewName);

      if (!localParticipant) return;

      const updatedMeta = JSON.stringify({
        callsign: cleanNewName,
        lat:
          localGps?.available && typeof localGps.lat === 'number'
            ? localGps.lat
            : null,
        lng:
          localGps?.available && typeof localGps.lng === 'number'
            ? localGps.lng
            : null,
        latLng: localGps?.latLngText || '',
        location: localGps?.location || '',
        updatedAt: Date.now(),
      });

      try {
        if (typeof localParticipant.updateName === 'function') {
          await localParticipant.updateName(cleanNewName);
        } else if (typeof localParticipant.setName === 'function') {
          await localParticipant.setName(cleanNewName);
        }

        if (typeof localParticipant.setMetadata === 'function') {
          await localParticipant.setMetadata(updatedMeta);
        }
      } catch (err) {
        console.warn('Gagal mengirim updateName ke server LiveKit:', err);
      }
    },
    [localParticipant, localGps, onUpdateParticipantName]
  );

  const handlePromptChangeName = useCallback(() => {
    try {
      const prompted =
        typeof window !== 'undefined' && typeof window.prompt === 'function'
          ? window.prompt('Masukkan Callsign / Nama Personel Baru:', participantName)
          : null;

      if (prompted !== null && prompted.trim() !== '') {
        executeParticipantRename(prompted);
        return;
      }

      // Jika window.prompt diblokir oleh sandbox iframe (mengembalikan null seketika),
      // tampilkan modal input taktis agar pengguna tetap bisa mengubah nama dengan mulus.
      if (prompted === null) {
        setShowRenameModal(true);
      }
    } catch {
      setShowRenameModal(true);
    }
  }, [participantName, executeParticipantRename]);

  /**
   * ============================================================================
   * DOKTRIN 5: SWITCH CAMERA (PINDAH KAMERA DEPAN / BELAKANG)
   * Memanfaatkan fungsi bawaan video track (`restartTrack`) dan `room.switchActiveDevice`
   * ============================================================================
   */
  const handleSwitchCamera = useCallback(async () => {
    if (!room || isSwitchingCamera) return;
    setIsSwitchingCamera(true);

    try {
      if (!isCameraEnabled && localParticipant) {
        await localParticipant.setCameraEnabled(true);
      }

      const nextFacing = cameraFacingMode === 'user' ? 'environment' : 'user';
      const camPub = localParticipant?.getTrackPublication(Track.Source.Camera);

      // 1. Utamakan fungsi bawaan video track `restartTrack({ facingMode })`
      if (camPub?.track && typeof camPub.track.restartTrack === 'function') {
        try {
          await camPub.track.restartTrack({ facingMode: nextFacing });
          setCameraFacingMode(nextFacing);
          return;
        } catch {
          // Lanjut ke enumerateDevices + switchActiveDevice jika browser membutuhkan deviceId eksplisit
        }
      }

      // 2. Fallback enumerateDevices + room.switchActiveDevice('videoinput', targetDeviceId)
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');

      if (videoInputs.length > 1) {
        const currentSettingsId =
          camPub?.track?.mediaStreamTrack?.getSettings?.()?.deviceId || activeCameraId;
        const currentIndex = videoInputs.findIndex(
          (d) => d.deviceId === currentSettingsId
        );
        const nextIndex = (currentIndex + 1) % videoInputs.length;
        const targetDevice = videoInputs[nextIndex];

        if (targetDevice?.deviceId) {
          await room.switchActiveDevice('videoinput', targetDevice.deviceId);
          setActiveCameraId(targetDevice.deviceId);
          setCameraFacingMode(nextFacing);
        }
      }
    } catch (err) {
      console.error('Gagal menukar kamera depan/belakang:', err);
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [
    room,
    localParticipant,
    isCameraEnabled,
    cameraFacingMode,
    activeCameraId,
    isSwitchingCamera,
  ]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Renderer Audio Seluruh Peserta */}
      <RoomAudioRenderer />

      {/* 1. HEADER ATAS */}
      <LiveKitHeaderHUD
        roomName={roomName}
        participantName={participantName}
        lowBandwidthMode={lowBandwidthMode}
        localGps={localGps}
        onOpenQrModal={onOpenQrModal}
      />

      {/* 2. AREA TENGAH: SMART GRID 4 KOTAK (grid-cols-2 grid-rows-2) DENGAN PAGINATION */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden bg-slate-900 p-1.5 sm:p-2.5">
        <div className="tactical-smart-grid grid grid-cols-2 grid-rows-2 gap-1.5 sm:gap-2.5 h-full w-full">
          {visibleGridItems.map((item) => (
            <CustomParticipantTile
              key={item.key}
              trackRef={item.trackRef}
              participant={item.participant}
              localGps={localGps}
              localCallsign={participantName}
            />
          ))}
        </div>

        {/* TOMBOL PANAH TRANSPARAN PAGINATION (NEXT / PREV PAGE) JIKA PESERTA > 4 */}
        {sortedGridItems.length > MAX_TILES_PER_PAGE && (
          <>
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
              disabled={currentPage === 0}
              className="absolute left-2 top-1/2 -translate-y-1/2 z-40 p-2 sm:p-3 rounded-full bg-slate-950/55 hover:bg-slate-900/80 disabled:opacity-25 backdrop-blur-sm border border-sky-300/45 text-sky-200 shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed"
              title="Halaman Peserta Sebelumnya (Prev Page)"
            >
              <ChevronLeft className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-300" />
            </button>

            <button
              type="button"
              onClick={() =>
                setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))
              }
              disabled={currentPage >= totalPages - 1}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-40 p-2 sm:p-3 rounded-full bg-slate-950/55 hover:bg-slate-900/80 disabled:opacity-25 backdrop-blur-sm border border-sky-300/45 text-sky-200 shadow-lg transition-all cursor-pointer disabled:cursor-not-allowed"
              title="Halaman Peserta Berikutnya (Next Page)"
            >
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6 text-cyan-300" />
            </button>

            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-full bg-slate-950/65 backdrop-blur-sm border border-sky-300/40 text-[10px] font-mono font-bold text-cyan-300 tracking-wider uppercase">
              HALAMAN {currentPage + 1} / {totalPages} ({sortedGridItems.length} TILE)
            </div>
          </>
        )}

        {/* Watermark Taktis di Belakang */}
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3 overflow-hidden">
          <div className="flex items-start justify-end">
            <div className="text-[9px] sm:text-[10px] font-bold tracking-widest text-sky-300/75 uppercase drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
              CONFIDENTIAL - DISKOMLEKAU · {roomName}
            </div>
          </div>

          <div className="flex items-center justify-center my-auto">
            <div className="text-center opacity-10 select-none">
              <p className="text-sm sm:text-xl md:text-2xl font-extrabold tracking-[0.28em] text-sky-300 uppercase">
                CONFIDENTIAL - DISKOMLEKAU
              </p>
            </div>
          </div>

          <div />
        </div>

        <RealTimeChatOverlay
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
          localCallsign={participantName}
          onUnreadChange={setUnreadChatCount}
        />

        <RealTimeParticipantsModal
          isOpen={showParticipantsModal}
          onClose={() => setShowParticipantsModal(false)}
          roomName={roomName}
          localGps={localGps}
          localCallsign={participantName}
        />

        <RenamePromptModal
          isOpen={showRenameModal}
          onClose={() => setShowRenameModal(false)}
          currentName={participantName}
          onConfirmRename={executeParticipantRename}
        />
      </div>

      {/* 3. CUSTOM CONTROL BAR (DOKTRIN 1, 4, & 5) */}
      <div className="shrink-0 bg-blue-950/95 border-t border-sky-300/35 px-2 py-2 sm:px-4 flex items-center justify-between gap-2 z-30">
        <div className="hidden xl:flex items-center gap-2 text-xs text-sky-200 shrink-0">
          <span className="px-2.5 py-1 rounded-md bg-slate-900/90 border border-sky-300/30">
            ROOM: <strong className="text-sky-300">{roomName}</strong>
          </span>
        </div>

        <div className="flex items-center justify-start sm:justify-center xl:justify-end gap-1.5 sm:gap-2 w-full xl:w-auto overflow-x-auto no-scrollbar">
          {/* TOMBOL MIC ON/OFF */}
          <TrackToggle
            source={Track.Source.Microphone}
            showIcon={true}
            className="flex items-center justify-center gap-1 !px-2.5 !py-2 !rounded-lg !border !border-sky-300/45 !bg-slate-900 hover:!bg-slate-800 !text-sky-200 !text-[10px] sm:!text-xs !font-bold !tracking-wider !uppercase transition-all cursor-pointer shrink-0"
          >
            <span className="hidden md:inline">MIC</span>
          </TrackToggle>

          {/* TOMBOL KAMERA ON/OFF */}
          <TrackToggle
            source={Track.Source.Camera}
            showIcon={true}
            className="flex items-center justify-center gap-1 !px-2.5 !py-2 !rounded-lg !border !border-sky-300/45 !bg-slate-900 hover:!bg-slate-800 !text-sky-200 !text-[10px] sm:!text-xs !font-bold !tracking-wider !uppercase transition-all cursor-pointer shrink-0"
          >
            <span className="hidden md:inline">CAM</span>
          </TrackToggle>

          {/* DOKTRIN 5: SEMBUNYIKAN SHARE SCREEN DI MOBILE, TAMPILKAN HANYA DI DESKTOP */}
          {!isMobileDevice && (
            <TrackToggle
              source={Track.Source.ScreenShare}
              showIcon={true}
              className="lk-custom-screenshare-toggle flex items-center justify-center gap-1.5 !px-2.5 !py-2 sm:!px-3 !rounded-lg !border !border-sky-300/45 !bg-slate-900 hover:!bg-slate-800 !text-sky-300 !text-[10px] sm:!text-xs !font-bold !tracking-wider !uppercase transition-all cursor-pointer shrink-0"
            >
              <span>SHARE SCREEN</span>
            </TrackToggle>
          )}

          {/* DOKTRIN 5: TOMBOL SWITCH CAMERA (PINDAH KAMERA DEPAN / BELAKANG) */}
          <button
            type="button"
            onClick={handleSwitchCamera}
            disabled={isSwitchingCamera}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-cyan-300/50 bg-slate-900 hover:bg-slate-800 text-cyan-300 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 disabled:opacity-50"
            title="Switch Camera (Pindah Kamera Depan / Belakang)"
          >
            <SwitchCamera
              className={`w-4 h-4 shrink-0 ${isSwitchingCamera ? 'animate-spin' : ''}`}
            />
            <span>PINDAH KAMERA</span>
          </button>

          {/* DOKTRIN 4: TOMBOL UBAH SANDI/NAMA DI TENGAH RAPAT */}
          <button
            type="button"
            onClick={handlePromptChangeName}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-sky-300/55 bg-sky-400/15 hover:bg-sky-400/25 text-sky-200 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0"
            title="Ubah Callsign / Nama Personel Secara Real-Time"
          >
            <Edit3 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>UBAH SANDI/NAMA</span>
          </button>

          {/* DOKTRIN 1: TOMBOL SHARE LINK VTC DI CONTROL BAR */}
          <button
            type="button"
            onClick={onShareVtcLink}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-cyan-300/55 bg-cyan-400/15 hover:bg-cyan-400/25 text-cyan-200 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0"
            title="Bagikan Link Undangan VTC (Web Share API / Copy Clipboard)"
          >
            {shareLinkStatus ? (
              <>
                <Check className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                <span>{shareLinkStatus}</span>
              </>
            ) : (
              <>
                <Share2 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                <span>SHARE LINK VTC</span>
              </>
            )}
          </button>

          {/* TOMBOL CHAT REAL-TIME */}
          <button
            type="button"
            onClick={() => setIsChatOpen((prev) => !prev)}
            className={`relative flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 ${
              isChatOpen
                ? 'bg-sky-300 text-slate-950 border-sky-200 shadow-[0_0_16px_rgba(125,211,252,0.45)]'
                : 'bg-slate-900 hover:bg-slate-800 text-sky-300 border-sky-300/45'
            }`}
            title="Buka Panel Chat Korespondensi Real-Time"
          >
            <MessageSquare className="w-4 h-4 shrink-0" />
            <span>CHAT</span>
            {unreadChatCount > 0 && !isChatOpen && (
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-300 text-slate-950 text-[10px] font-extrabold">
                {unreadChatCount}
              </span>
            )}
          </button>

          {/* TOMBOL DAFTAR PERSONEL */}
          <button
            type="button"
            onClick={() => setShowParticipantsModal(true)}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-sky-300/40 bg-slate-900 hover:bg-slate-800 text-sky-200 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer shrink-0"
          >
            <Users className="w-4 h-4 text-sky-300 shrink-0" />
            <span>PERSONEL ({participants.length})</span>
          </button>

          {/* TOMBOL MODE HEMAT DATA */}
          <button
            type="button"
            onClick={() => onToggleLowBandwidth(!lowBandwidthMode)}
            className={`hidden sm:flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 ${
              lowBandwidthMode
                ? 'bg-amber-400 text-slate-950 border-amber-200'
                : 'bg-slate-900 hover:bg-slate-800 text-sky-200 border-sky-300/40'
            }`}
          >
            {lowBandwidthMode ? (
              <Zap className="w-4 h-4 shrink-0" />
            ) : (
              <ZapOff className="w-4 h-4 text-sky-300 shrink-0" />
            )}
            <span className="hidden md:inline">
              {lowBandwidthMode ? 'VOICE-ONLY' : 'HEMAT DATA'}
            </span>
          </button>

          {/* TOMBOL KELUAR RAPAT */}
          <button
            type="button"
            onClick={onLeave}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-400/80 bg-red-600/90 hover:bg-red-500 text-white text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer shrink-0"
          >
            <PhoneOff className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">KELUAR</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * KOMPONEN UTAMA APLIKASI (App.jsx)
 * ============================================================================
 */
export default function App() {
  const [appState, setAppState] = useState('LOBBY');

  // DOKTRIN 1: State default Callsign/NRP wajib "" (string kosong)
  const [participantName, setParticipantName] = useState(DEFAULT_CALLSIGN);
  const [roomName, setRoomName] = useState(DEFAULT_ROOM_NAME);
  const [sandi, setSandi] = useState(DEFAULT_SANDI);
  const [customServerUrl, setCustomServerUrl] = useState(
    import.meta.env.VITE_LIVEKIT_URL || ''
  );
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false);

  const [token, setToken] = useState('');
  const [serverUrl, setServerUrl] = useState(import.meta.env.VITE_LIVEKIT_URL || '');
  const [isLoading, setIsLoading] = useState(false);
  const [isDeepLinkJoining, setIsDeepLinkJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [lowBandwidthMode, setLowBandwidthMode] = useState(false);
  const [showQrModal, setShowQrModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [shareLinkStatus, setShareLinkStatus] = useState('');

  // Hook Geolocation GPS & Reverse Geocoding Nominatim OpenStreetMap
  const localGps = useTacticalGpsLocation();

  const cleanRoomParam = (roomName || DEFAULT_ROOM_NAME).trim();
  const cleanSandiParam = (sandi || DEFAULT_SANDI).trim();
  const deepLinkUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}?room=${encodeURIComponent(
          cleanRoomParam
        )}&sandi=${encodeURIComponent(cleanSandiParam)}`
      : '';

  const qrCodeImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
    deepLinkUrl
  )}`;

  /**
   * DOKTRIN 1: FUNGSI "SHARE LINK VTC" (DI LOBBY & DI CONTROL BAR IN_CALL)
   * Menggunakan Web Share API (`navigator.share`) jika tersedia di HP,
   * dengan fallback copy ke clipboard (`navigator.clipboard.writeText`) untuk Desktop.
   */
  const handleShareVtcLink = useCallback(async () => {
    if (!deepLinkUrl) return;

    const sharePayload = {
      title: 'TACTICAL VIDCOMM DISKOMLEKAU',
      text: `Undangan Rapat VTC Operasi — Room: ${cleanRoomParam} | Sandi: ${cleanSandiParam}`,
      url: deepLinkUrl,
    };

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share(sharePayload);
        setShareLinkStatus('DIBAGIKAN!');
        setTimeout(() => setShareLinkStatus(''), 2500);
        return;
      } catch (err) {
        // Jika user membatalkan dialog share native, jangan paksa error;
        // jika gagal karena lingkungan iframe/desktop, lanjut ke fallback clipboard.
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(deepLinkUrl);
      setShareLinkStatus('LINK TERSALIN!');
      setTimeout(() => setShareLinkStatus(''), 2500);
    } catch {
      setShowQrModal(true);
    }
  }, [deepLinkUrl, cleanRoomParam, cleanSandiParam]);

  const requestTokenAndJoin = useCallback(
    async (targetRoom, targetCallsign, targetSandi) => {
      setErrorMsg('');
      const finalRoom = String(targetRoom || '').trim();
      const finalCallsign = String(targetCallsign || '').trim();
      const finalSandi = String(targetSandi ?? '').trim();

      if (!finalCallsign) {
        setErrorMsg('Callsign / NRP Personel wajib diisi sebelum bergabung.');
        return false;
      }

      if (!finalRoom) {
        setErrorMsg('Nama Room / Operasi wajib diisi.');
        return false;
      }

      if (!finalSandi) {
        setErrorMsg('Sandi Gabung operasi wajib diisi.');
        return false;
      }

      const initialMetadata = JSON.stringify({
        callsign: finalCallsign,
        lat:
          localGps?.available && typeof localGps.lat === 'number'
            ? localGps.lat
            : null,
        lng:
          localGps?.available && typeof localGps.lng === 'number'
            ? localGps.lng
            : null,
        latLng: localGps?.latLngText || '',
        location: localGps?.location || '',
      });

      setIsLoading(true);
      try {
        const response = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName: finalRoom,
            participantName: finalCallsign,
            displayName: finalCallsign,
            metadata: initialMetadata,
            sandi: finalSandi,
            pwd: finalSandi,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(
            data.error || 'Gagal mendapatkan token otentikasi dari endpoint /api/token.'
          );
        }

        const resolvedWssUrl =
          customServerUrl.trim() || data.serverUrl || import.meta.env.VITE_LIVEKIT_URL || '';

        if (!resolvedWssUrl) {
          throw new Error(
            'URL Server LiveKit (WSS) belum dikonfigurasi pada environment server (LIVEKIT_URL / VITE_LIVEKIT_URL).'
          );
        }

        setParticipantName(finalCallsign);
        setRoomName(finalRoom);
        setSandi(finalSandi);
        setToken(data.token);
        setServerUrl(resolvedWssUrl);
        setAppState('IN_CALL');
        return true;
      } catch (err) {
        setErrorMsg(err.message || 'Gagal menghubungi endpoint /api/token.');
        return false;
      } finally {
        setIsLoading(false);
        setIsDeepLinkJoining(false);
      }
    },
    [
      customServerUrl,
      localGps?.available,
      localGps?.lat,
      localGps?.lng,
      localGps?.latLngText,
      localGps?.location,
    ]
  );

  // Deteksi Deep Link Join via URLSearchParams (?room=yes&sandi=yes)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = params.get('room');
    const sandiFromUrl = params.get('sandi') || params.get('pwd');
    const callsignFromUrl = params.get('callsign');

    if (roomFromUrl && sandiFromUrl) {
      const autoCallsign = callsignFromUrl
        ? callsignFromUrl.trim()
        : generateRandomCallsign();

      setRoomName(roomFromUrl.trim());
      setSandi(sandiFromUrl.trim());
      setParticipantName(autoCallsign);
      setIsDeepLinkJoining(true);

      requestTokenAndJoin(roomFromUrl, autoCallsign, sandiFromUrl);
    }
  }, [requestTokenAndJoin]);

  const handleJoinSubmit = async (e) => {
    e.preventDefault();
    if (!participantName.trim()) return;
    await requestTokenAndJoin(roomName, participantName, sandi);
  };

  const handleLeaveCall = () => {
    setToken('');
    setAppState('LOBBY');
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  const handleCopyDeepLink = async () => {
    if (!deepLinkUrl) return;
    try {
      await navigator.clipboard.writeText(deepLinkUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Abaikan jika clipboard tidak diizinkan
    }
  };

  const isCallsignEmpty = !participantName.trim();

  return (
    /* PEMBUNGKUS UTAMA: TEMA ELEGANT LIGHT BLUE & FULL SCREEN FIT TANPA SCROLLBAR */
    <div
      className={`flex flex-col h-[100dvh] w-full overflow-hidden font-mono bg-slate-900 text-sky-300 select-none ${
        lowBandwidthMode ? 'low-bandwidth-active' : ''
      }`}
    >
      {isDeepLinkJoining && appState === 'LOBBY' && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-blue-950 text-center">
          <div className="flex items-center gap-3 mb-4">
            <TacticalRadarLogo className="w-14 h-14 animate-pulse" />
            <TniAuLogo className="w-14 h-14 animate-pulse" />
          </div>
          <h2 className="text-base sm:text-xl font-bold text-sky-300 tracking-wider uppercase">
            MEMPROSES DEEP LINK UNDANGAN...
          </h2>
          <p className="text-xs sm:text-sm text-cyan-300 mt-1">
            ROOM: {roomName} · CALLSIGN: {participantName}
          </p>
          <p className="text-xs text-slate-400 mt-3 max-w-sm">
            Menghubungi endpoint /api/token dan menginisialisasi kanal enkripsi LiveKit WebRTC...
          </p>
        </div>
      )}

      {!isDeepLinkJoining && appState === 'LOBBY' && (
        <>
          <header className="shrink-0 bg-blue-950/95 border-b border-sky-300/30 px-4 py-2.5 sm:px-6 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <TacticalRadarLogo className="w-9 h-9 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xs sm:text-base md:text-lg font-bold tracking-wider text-sky-300 truncate">
                    TACTICAL VIDCOMM DISKOMLEKAU
                  </h1>
                  <TniAuLogo className="w-9 h-9 shrink-0" />
                </div>
                <p className="text-[10px] sm:text-xs text-blue-400 tracking-widest truncate">
                  SECURE COMMAND & COORDINATION TELECONFERENCE
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <PWAInstallButton />

              <button
                type="button"
                onClick={handleShareVtcLink}
                className="px-3 py-1.5 rounded-lg bg-cyan-400/15 hover:bg-cyan-400/25 border border-cyan-300/50 text-cyan-200 text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                title="Share Link VTC (Web Share API / Salin Clipboard)"
              >
                {shareLinkStatus ? (
                  <>
                    <Check className="w-4 h-4 text-cyan-300" />
                    <span>{shareLinkStatus}</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-4 h-4 text-cyan-300" />
                    <span className="hidden sm:inline">SHARE LINK VTC</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowQrModal(true)}
                className="px-3 py-1.5 rounded-lg bg-sky-400/15 hover:bg-sky-400/25 border border-sky-300/50 text-sky-300 text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <QrCode className="w-4 h-4 text-cyan-300" />
                <span className="hidden md:inline">QR UNDANGAN</span>
              </button>
            </div>
          </header>

          <main className="flex-1 min-h-0 flex items-center justify-center p-3 sm:p-6 overflow-y-auto relative bg-gradient-to-b from-slate-900 via-blue-950/90 to-slate-900">
            <div
              className="absolute inset-0 pointer-events-none opacity-15"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(125,211,252,0.2) 1px, transparent 1px), linear-gradient(to bottom, rgba(125,211,252,0.2) 1px, transparent 1px)',
                backgroundSize: '32px 32px',
              }}
            />

            <div className="relative z-10 w-full max-w-lg bg-slate-900/95 border border-sky-300/40 rounded-2xl p-5 sm:p-6 shadow-[0_0_40px_rgba(56,189,248,0.18)]">
              <div className="flex items-center justify-between border-b border-sky-300/25 pb-3.5 mb-4">
                <div>
                  <span className="text-[10px] sm:text-[11px] uppercase tracking-widest text-cyan-300 font-bold flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-sky-300" />
                    OTENTIKASI JARINGAN KOMANDO
                  </span>
                  <h2 className="text-base sm:text-xl font-bold text-sky-300 tracking-wide mt-0.5">
                    TERMINAL VIDCOMM OPERASI
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <Radio className="w-6 h-6 text-blue-400 shrink-0" />
                </div>
              </div>

              {/* Panel Status Telemetri GPS Personel */}
              <div className="mb-3.5 px-3.5 py-2.5 rounded-xl bg-blue-950/80 border border-sky-300/35 flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                      OVERLAY HUD TAKTIS (GPS & LOKASI)
                    </span>
                    <span className="text-[10px] text-cyan-300 font-semibold">
                      {localGps.available ? 'GPS AKTIF' : localGps.status}
                    </span>
                  </div>
                  {localGps.available && localGps.latLngText ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="font-mono font-bold text-cyan-300 text-xs">
                        {localGps.latLngText}
                      </p>
                      <p className="text-[11px] text-sky-200">
                        {localGps.location || 'Mendeteksi Kecamatan/Kota via Nominatim...'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Format HUD Video: CALLSIGN | LAT,LNG | NAMA LOKASI
                    </p>
                  )}
                </div>
              </div>

              <form onSubmit={handleJoinSubmit} className="space-y-3.5">
                {/* DOKTRIN 1: CALLSIGN KOSONG DI AWAL */}
                <div>
                  <label
                    htmlFor="callsign-input"
                    className="block text-xs font-bold uppercase tracking-wider text-sky-300 mb-1 flex items-center justify-between"
                  >
                    <span>CALLSIGN / NRP PERSONEL</span>
                    {isCallsignEmpty && (
                      <span className="text-[10px] text-amber-300 font-semibold">
                        * WAJIB DIISI
                      </span>
                    )}
                  </label>
                  <input
                    id="callsign-input"
                    type="text"
                    required
                    value={participantName}
                    onChange={(e) => setParticipantName(e.target.value)}
                    autoComplete="off"
                    className="w-full px-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/80 border border-sky-300/45 rounded-lg text-sky-200 focus:outline-none focus:border-cyan-300"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="room-input"
                      className="block text-xs font-bold uppercase tracking-wider text-sky-300 mb-1"
                    >
                      NAMA ROOM / OPERASI
                    </label>
                    <input
                      id="room-input"
                      type="text"
                      required
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      autoComplete="off"
                      className="w-full px-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/80 border border-sky-300/45 rounded-lg text-cyan-300 focus:outline-none focus:border-cyan-300"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="sandi-input"
                      className="block text-xs font-bold uppercase tracking-wider text-sky-300 mb-1 flex items-center justify-between"
                    >
                      <span>SANDI GABUNG</span>
                      <span className="text-[10px] text-cyan-300">DEFAULT: yes</span>
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-sky-300/70 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        id="sandi-input"
                        type="text"
                        required
                        value={sandi}
                        onChange={(e) => setSandi(e.target.value)}
                        autoComplete="off"
                        className="w-full pl-9 pr-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/80 border border-sky-300/45 rounded-lg text-sky-200 focus:outline-none focus:border-cyan-300"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
                    className="text-[11px] text-blue-400 hover:text-sky-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>
                      {showAdvancedConfig
                        ? 'Sembunyikan Server LiveKit'
                        : 'Konfigurasi WSS LiveKit'}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLowBandwidthMode(!lowBandwidthMode)}
                    className={`text-[10px] px-2.5 py-1 rounded border font-bold tracking-wider uppercase cursor-pointer ${
                      lowBandwidthMode
                        ? 'bg-amber-400/20 border-amber-300 text-amber-300'
                        : 'bg-blue-950/70 border-sky-300/30 text-sky-300 hover:border-cyan-300'
                    }`}
                  >
                    {lowBandwidthMode ? '✓ VOICE-ONLY AKTIF' : 'MODE VIDEO PENUH'}
                  </button>
                </div>

                {showAdvancedConfig && (
                  <div>
                    <input
                      type="text"
                      value={customServerUrl}
                      onChange={(e) => setCustomServerUrl(e.target.value)}
                      placeholder="wss://proyek-anda.livekit.cloud"
                      className="w-full px-3 py-2 text-xs bg-blue-950/90 border border-sky-300/40 rounded-lg text-sky-200 placeholder-slate-500 focus:outline-none focus:border-cyan-300"
                    />
                  </div>
                )}

                {errorMsg && (
                  <div className="p-3 rounded-lg bg-red-950/80 border border-red-400/60 text-red-200 text-xs flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* DOKTRIN 1: TOMBOL "GABUNG RAPAT" DISABLED JIKA CALLSIGN KOSONG & TOMBOL "SHARE LINK VTC" */}
                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="submit"
                    disabled={isLoading || isCallsignEmpty}
                    className="w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase bg-sky-400 hover:bg-sky-300 text-slate-950 border border-cyan-300 shadow-[0_0_20px_rgba(56,189,248,0.3)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {isLoading ? 'MENGHUBUNGKAN...' : 'GABUNG RAPAT'}
                  </button>

                  <button
                    type="button"
                    onClick={handleShareVtcLink}
                    className="w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase bg-blue-950 hover:bg-blue-900 text-cyan-300 border border-cyan-300/60 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    {shareLinkStatus ? (
                      <>
                        <Check className="w-4 h-4 text-cyan-300 shrink-0" />
                        <span>{shareLinkStatus}</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-4 h-4 text-cyan-300 shrink-0" />
                        <span>SHARE LINK VTC</span>
                      </>
                    )}
                  </button>
                </div>
              </form>

              <div className="mt-4 pt-3 border-t border-sky-300/20 flex items-center justify-between text-[10px] sm:text-[11px] text-blue-400">
                <span className="inline-flex items-center gap-1.5 text-sky-300 font-semibold">
                  <Lock className="w-3.5 h-3.5 text-cyan-300" />
                  SMART GRID 2X2 · GPS TELEMETRY HUD
                </span>
                <span>DISKOMLEKAU · TNI AU</span>
              </div>
            </div>
          </main>
        </>
      )}

      {appState === 'IN_CALL' && token && serverUrl && (
        <LiveKitRoom
          video={!lowBandwidthMode}
          audio={true}
          token={token}
          serverUrl={serverUrl}
          connect={true}
          data-lk-theme="default"
          onDisconnected={handleLeaveCall}
          onError={(err) => {
            console.error('[LiveKit Room Error]:', err);
            setErrorMsg(err?.message || 'Koneksi ke server LiveKit terputus.');
          }}
          className="!h-full !w-full !overflow-hidden flex flex-col"
        >
          <InCallWorkspace
            roomName={roomName}
            participantName={participantName}
            onUpdateParticipantName={setParticipantName}
            lowBandwidthMode={lowBandwidthMode}
            localGps={localGps}
            onToggleLowBandwidth={setLowBandwidthMode}
            onLeave={handleLeaveCall}
            onOpenQrModal={() => setShowQrModal(true)}
            onShareVtcLink={handleShareVtcLink}
            shareLinkStatus={shareLinkStatus}
          />
        </LiveKitRoom>
      )}

      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-slate-900 border border-sky-300/50 rounded-2xl p-5 shadow-[0_0_45px_rgba(56,189,248,0.25)] flex flex-col items-center text-center gap-3.5">
            <div className="w-full flex items-center justify-between border-b border-sky-300/25 pb-2.5">
              <div className="text-left">
                <h3 className="text-xs sm:text-sm font-bold text-sky-300 tracking-wider uppercase">
                  QR UNDANGAN RAPAT (DEEP LINK)
                </h3>
                <p className="text-[10px] text-cyan-300">
                  SCAN DENGAN KAMERA HP · AUTO-JOIN TANPA APK
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="p-1.5 rounded-lg bg-blue-950 border border-sky-300/30 text-sky-300 hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 rounded-2xl bg-white border-4 border-sky-300 shadow-lg flex items-center justify-center">
              <img
                src={qrCodeImageUrl}
                alt={`QR Undangan Room ${cleanRoomParam}`}
                width={200}
                height={200}
                referrerPolicy="no-referrer"
                className="w-[200px] h-[200px] object-contain"
              />
            </div>

            <div className="w-full p-3 rounded-xl bg-blue-950/90 border border-sky-300/35 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-blue-400">ROOM OPERASI:</span>
                <span className="text-sky-300 font-bold">{cleanRoomParam}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-blue-400">SANDI GABUNG:</span>
                <span className="text-cyan-300 font-bold">{cleanSandiParam}</span>
              </div>
            </div>

            <div className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-sky-300/30 text-[10px] text-sky-300 break-all">
              {deepLinkUrl}
            </div>

            <button
              type="button"
              onClick={handleCopyDeepLink}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-400 hover:bg-sky-300 text-slate-950 font-bold text-xs tracking-wider uppercase flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>LINK UNDANGAN TERSALIN</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>SALIN LINK UNDANGAN</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
