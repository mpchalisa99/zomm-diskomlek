/**
 * ============================================================================
 * FILE FRONTEND: src/App.jsx
 * TACTICAL VIDCOMM DISKOMLEKAU — 100% PRODUCTION WEBRTC LIVEKIT & PWA
 *
 * Fitur Utama:
 * 1. Callsign Awal Kosong ("") saat Login & Tombol "GABUNG" Disabled jika Callsign kosong.
 * 2. Grid 6 Client di Mobile (<GridLayout /> + CustomParticipantTile):
 *    - Memaksa 2 kolom x 3 baris (grid-cols-2 grid-rows-3) pada layar mobile (<= 768px)
 *      dengan min-h-[130px] agar 6 video personel muat utuh di layar HP vertikal.
 * 3. Fitur Ubah Sandi/Nama Saat Rapat (In-Call):
 *    - Tombol "UBAH SANDI/NAMA" di Control Bar memunculkan modal input nama baru.
 *    - Mengeksekusi perubahan secara real-time via `useLocalParticipant()` menggunakan
 *      `localParticipant.setName(newName)` / `updateName` dan `localParticipant.setMetadata(...)`.
 * 4. Overlay Identitas & GPS Transparan (HUD Taktis):
 *    - Saat IN_CALL, mengambil Latitude & Longitude via `navigator.geolocation.getCurrentPosition()`
 *      dan `watchPosition()`, lalu melakukan Reverse Geocoding via Nominatim OpenStreetMap
 *      (misal: "Kec. Colomadu, Karanganyar") dan menyimpannya ke Metadata LiveKit.
 *    - Membungkus `<ParticipantTile />` dengan `<CustomParticipantTile />` dan menampilkan
 *      overlay absolut `absolute bottom-1 left-1 right-1 z-50 bg-black/40 text-white text-[8px]
 *      md:text-[10px] font-mono p-1 rounded leading-tight backdrop-blur-sm` dengan format:
 *      "[CALLSIGN/NAMA] | [LAT, LNG] | [LOKASI]".
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LiveKitRoom,
  GridLayout,
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
  useMaybeTrackRefContext,
  useMaybeParticipantContext,
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
} from 'lucide-react';

// 1. SETTING DEFAULT LOBBY: Callsign wajib kosong ("") di awal
const DEFAULT_CALLSIGN = '';
const DEFAULT_ROOM_NAME = 'yes';
const DEFAULT_SANDI = 'yes';

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
 * ============================================================================
 * HELPER KONVERSI KOORDINAT DESIMAL KE FORMAT DMS INDONESIA
 * Contoh Output: 7°15'30" LS, 110°25'45" BT
 * ============================================================================
 */
function convertSingleCoordToDMS(decimalDegree, isLatitude) {
  const dir = isLatitude
    ? decimalDegree >= 0
      ? 'LU'
      : 'LS'
    : decimalDegree >= 0
    ? 'BT'
    : 'BB';
  const absVal = Math.abs(decimalDegree);
  const degrees = Math.floor(absVal);
  const minutesFloat = (absVal - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60);

  const finalSeconds = seconds === 60 ? 0 : seconds;
  const finalMinutes = seconds === 60 ? minutes + 1 : minutes;
  const finalDegrees = finalMinutes === 60 ? degrees + 1 : degrees;
  const normalizedMinutes = finalMinutes === 60 ? 0 : finalMinutes;

  return `${finalDegrees}°${String(normalizedMinutes).padStart(2, '0')}'${String(
    finalSeconds
  ).padStart(2, '0')}" ${dir}`;
}

function formatGpsToIndonesianDMS(latitude, longitude) {
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return '';
  return `${convertSingleCoordToDMS(latitude, true)}, ${convertSingleCoordToDMS(
    longitude,
    false
  )}`;
}

/**
 * Helper Ekstraksi Metadata Identitas & GPS dari Participant LiveKit
 */
function parseParticipantGpsMetadata(participant) {
  if (!participant?.metadata) return null;
  try {
    const parsed = JSON.parse(participant.metadata);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // Metadata bukan JSON
  }
  return null;
}

/**
 * ============================================================================
 * HOOK: REAL-TIME GEOLOCATION + REVERSE GEOCODING (NOMINATIM OPENSTREETMAP)
 * Mengambil Latitude & Longitude perangkat menggunakan `getCurrentPosition()`
 * serta mengubah koordinat menjadi nama lokasi (contoh: "Kec. Colomadu").
 * ============================================================================
 */
function useTacticalGpsLocation() {
  const [gpsData, setGpsData] = useState({
    available: false,
    status: 'MENCARI GPS...',
    latitude: null,
    longitude: null,
    latLngText: '',
    accuracy: null,
    dms: '',
    kecamatan: '',
    kabupaten: '',
    provinsi: '',
    regionLabel: '',
  });

  const lastGeocodeCoordRef = useRef({ lat: null, lon: null });

  const reverseGeocodeCoordinates = useCallback(async (lat, lon) => {
    if (
      lastGeocodeCoordRef.current.lat !== null &&
      Math.abs(lastGeocodeCoordRef.current.lat - lat) < 0.001 &&
      Math.abs(lastGeocodeCoordRef.current.lon - lon) < 0.001
    ) {
      return;
    }
    lastGeocodeCoordRef.current = { lat, lon };

    try {
      // 1. Nominatim OpenStreetMap Reverse Geocoding API (Bahasa Indonesia)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1&accept-language=id`,
        {
          headers: {
            Accept: 'application/json',
          },
        }
      );

      if (res.ok) {
        const data = await res.json();
        const addr = data?.address || {};

        const rawKecamatan =
          addr.suburb ||
          addr.city_district ||
          addr.municipality ||
          addr.town ||
          addr.village ||
          addr.neighbourhood ||
          '';
        const rawKabupaten =
          addr.city ||
          addr.county ||
          addr.regency ||
          addr.state_district ||
          '';
        const rawProvinsi = addr.state || addr.province || addr.region || '';

        const cleanKecName = rawKecamatan.replace(/^(Kecamatan|Kec\.)\s+/i, '').trim();
        const formattedKec = cleanKecName ? `Kec. ${cleanKecName}` : '';
        const cleanKab = rawKabupaten.trim();
        const cleanProv = rawProvinsi
          .replace(/^(Provinsi|Daerah Khusus Ibukota)\s+/i, '')
          .trim();

        const parts = [formattedKec, cleanKab, cleanProv].filter(Boolean);
        const uniqueParts = parts.filter((item, idx) => parts.indexOf(item) === idx);
        const regionStr = uniqueParts.join(', ');

        if (regionStr) {
          setGpsData((prev) => ({
            ...prev,
            kecamatan: formattedKec,
            kabupaten: cleanKab,
            provinsi: cleanProv,
            regionLabel: regionStr,
          }));
          return;
        }
      }
    } catch {
      // Lanjut ke fallback kedua jika Nominatim gagal
    }

    try {
      // 2. Fallback: BigDataCloud Reverse Geocode Client API
      const fallbackRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`
      );
      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        const rawKec = (fbData.locality || '')
          .replace(/^(Kecamatan|Kec\.)\s+/i, '')
          .trim();
        const formattedKec = rawKec ? `Kec. ${rawKec}` : '';
        const kab = (fbData.city || fbData.principalSubdivision || '').trim();
        const prov = (fbData.principalSubdivision || '').trim();

        const parts = [formattedKec, kab, prov].filter(Boolean);
        const uniqueParts = parts.filter((item, idx) => parts.indexOf(item) === idx);
        const regionStr = uniqueParts.join(', ');

        if (regionStr) {
          setGpsData((prev) => ({
            ...prev,
            kecamatan: formattedKec,
            kabupaten: kab,
            provinsi: prov,
            regionLabel: regionStr,
          }));
        }
      }
    } catch {
      // Tetap gunakan koordinat jika perangkat sedang offline dari geocoder
    }
  }, []);

  const requestCurrentPosition = useCallback(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsData((prev) => ({
        ...prev,
        available: false,
        status: 'GPS TIDAK TERSEDIA',
      }));
      return;
    }

    const handleSuccess = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const dmsString = formatGpsToIndonesianDMS(latitude, longitude);
      const latLngFormatted = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      setGpsData((prev) => ({
        ...prev,
        available: true,
        status: 'GPS LOCKED',
        latitude,
        longitude,
        latLngText: latLngFormatted,
        accuracy: Math.round(accuracy || 0),
        dms: dmsString,
      }));

      reverseGeocodeCoordinates(latitude, longitude);
    };

    const handleError = (err) => {
      setGpsData((prev) => ({
        ...prev,
        available: false,
        status: err.code === 1 ? 'IZIN GPS DITOLAK' : 'SINYAL GPS BELUM TERSEDIA',
      }));
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000,
    });
  }, [reverseGeocodeCoordinates]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsData((prev) => ({
        ...prev,
        available: false,
        status: 'GPS TIDAK TERSEDIA',
      }));
      return;
    }

    const handleSuccess = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const dmsString = formatGpsToIndonesianDMS(latitude, longitude);
      const latLngFormatted = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

      setGpsData((prev) => ({
        ...prev,
        available: true,
        status: 'GPS LOCKED',
        latitude,
        longitude,
        latLngText: latLngFormatted,
        accuracy: Math.round(accuracy || 0),
        dms: dmsString,
      }));

      reverseGeocodeCoordinates(latitude, longitude);
    };

    const handleError = (err) => {
      setGpsData((prev) => ({
        ...prev,
        available: false,
        status: err.code === 1 ? 'IZIN GPS DITOLAK' : 'SINYAL GPS BELUM TERSEDIA',
      }));
    };

    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 15000,
    });

    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000,
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [reverseGeocodeCoordinates]);

  return {
    ...gpsData,
    refreshGps: requestCurrentPosition,
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

/**
 * Komponen Tombol Install PWA (Add to Home Screen)
 */
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
        title="Install TACTICAL VIDCOMM ke Layar Utama HP (PWA Standalone)"
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
                    MODE STANDALONE FULLSCREEN (TANPA PLAY STORE)
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
                  <li>
                    Ketuk ikon <strong>Share (Bagikan)</strong> di bilah bawah browser Safari.
                  </li>
                  <li>
                    Gulir ke bawah lalu pilih{' '}
                    <strong>&quot;Add to Home Screen&quot; (Tambah ke Layar Utama)</strong>.
                  </li>
                  <li>
                    Ketuk <strong>Add (Tambah)</strong> di pojok kanan atas.
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2 text-xs text-sky-100 leading-relaxed">
                <p className="font-bold text-cyan-300">Panduan Android (Chrome / Edge):</p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>
                    Buka URL aplikasi ini langsung di tab utama <strong>Google Chrome</strong> HP Anda.
                  </li>
                  <li>
                    Ketuk ikon menu <strong>Titik Tiga (⋮)</strong> di pojok kanan atas browser.
                  </li>
                  <li>
                    Pilih <strong>&quot;Install App&quot; (Instal Aplikasi)</strong> atau{' '}
                    <strong>&quot;Tambahkan ke Layar Utama&quot;</strong>.
                  </li>
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
 * Komponen Logo Resmi DISKOMLEKAU (Kiri)
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

/**
 * Komponen Logo Resmi TNI AU — Swa Bhuwana Paksa (Sebelah Kanan Tulisan)
 */
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
 * 4. CUSTOM PARTICIPANT TILE DENGAN OVERLAY IDENTITAS & GPS TRANSPARAN (HUD TAKTIS)
 * Membungkus `<ParticipantTile />` bawaan LiveKit dan menambahkan overlay absolut:
 * `absolute bottom-1 left-1 right-1 z-50 bg-black/40 text-white text-[8px] md:text-[10px]
 *  font-mono p-1 rounded leading-tight backdrop-blur-sm`
 * Format Teks: "[CALLSIGN/NAMA] | [LAT, LNG] | [LOKASI]"
 * ============================================================================
 */
function CustomParticipantTile({ localGps, localCallsign, ...tileProps }) {
  const contextTrackRef = useMaybeTrackRefContext();
  const contextParticipant = useMaybeParticipantContext();

  const activeTrackRef = tileProps.trackRef || contextTrackRef;
  const participant = activeTrackRef?.participant || contextParticipant;

  // Hook LiveKit yang otomatis merender ulang saat name/metadata peserta berubah
  const participantInfo = useParticipantInfo({ participant });

  const metaGps = parseParticipantGpsMetadata(participant);
  const isLocal = Boolean(participant?.isLocal);

  // 1. Resolusi [CALLSIGN/NAMA]
  const rawName =
    metaGps?.callsign ||
    participantInfo?.name ||
    participant?.name ||
    (isLocal ? localCallsign : '') ||
    participantInfo?.identity ||
    participant?.identity ||
    'PERSONEL';
  const displayCallsign = String(rawName).split('\n')[0].trim();

  // 2. Resolusi [LAT, LNG]
  let displayLatLng = 'GPS STANDBY';
  if (isLocal && localGps?.available && typeof localGps.latitude === 'number') {
    displayLatLng = `${localGps.latitude.toFixed(5)}, ${localGps.longitude.toFixed(5)}`;
  } else if (
    metaGps &&
    typeof metaGps.lat === 'number' &&
    typeof metaGps.lng === 'number'
  ) {
    displayLatLng = `${Number(metaGps.lat).toFixed(5)}, ${Number(metaGps.lng).toFixed(5)}`;
  } else if (
    metaGps &&
    typeof metaGps.lat === 'number' &&
    typeof metaGps.lon === 'number'
  ) {
    displayLatLng = `${Number(metaGps.lat).toFixed(5)}, ${Number(metaGps.lon).toFixed(5)}`;
  } else if (metaGps?.latLng) {
    displayLatLng = metaGps.latLng;
  } else if (metaGps?.dms) {
    displayLatLng = metaGps.dms;
  }

  // 3. Resolusi [LOKASI]
  const displayLocation = isLocal
    ? localGps?.regionLabel ||
      metaGps?.location ||
      metaGps?.region ||
      (localGps?.available ? 'MENDETEKSI LOKASI...' : localGps?.status || 'LOKASI OFF')
    : metaGps?.location || metaGps?.region || 'LOKASI BELUM TERSEDIA';

  const isScreenShareTrack =
    activeTrackRef?.source === Track.Source.ScreenShare;

  const formattedHudLine = `${displayCallsign}${
    isScreenShareTrack ? ' (SHARE SCREEN)' : ''
  } | ${displayLatLng} | ${displayLocation}`;

  return (
    <div className="tactical-tile-container relative w-full h-full min-h-[130px] overflow-hidden rounded-[10px]">
      <ParticipantTile
        {...tileProps}
        trackRef={activeTrackRef}
        className="!h-full !w-full min-h-[130px]"
      />

      {/* OVERLAY IDENTITAS & GPS TRANSPARAN (HUD TAKTIS) */}
      <div className="absolute bottom-1 left-1 right-1 z-50 bg-black/40 text-white text-[8px] md:text-[10px] font-mono p-1 rounded leading-tight backdrop-blur-sm pointer-events-none flex items-center justify-between gap-1.5 border border-sky-300/20">
        <span className="truncate font-semibold tracking-tight text-sky-100">
          {formattedHudLine}
        </span>

        {participant && (
          <ParticipantContextIfNeeded participant={participant}>
            <ConnectionQualityIndicator className="!p-0 !bg-transparent shrink-0" />
          </ParticipantContextIfNeeded>
        )}
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * KOMPONEN HUD INDIKATOR JARINGAN & GPS DI HEADER ATAS (<LiveKitRoom>)
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
                  {localGps.regionLabel && (
                    <span className="text-cyan-300">({localGps.regionLabel})</span>
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
 * 3. MODAL UBAH NAMA / CALLSIGN SAAT RAPAT (IN-CALL)
 * Mengeksekusi perubahan menggunakan `useLocalParticipant()` via
 * `localParticipant.setName(newName)` / `updateName` dan `localParticipant.setMetadata(...)`
 * ============================================================================
 */
function ChangeCallsignModal({
  isOpen,
  onClose,
  currentName,
  localGps,
  onSuccessUpdateName,
}) {
  const { localParticipant } = useLocalParticipant();
  const [newNameInput, setNewNameInput] = useState(currentName || '');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNewNameInput(currentName || '');
      setUpdateError('');
    }
  }, [isOpen, currentName]);

  if (!isOpen) return null;

  const handleSubmitNewName = async (e) => {
    e.preventDefault();
    const trimmedName = newNameInput.trim();
    if (!trimmedName) {
      setUpdateError('Callsign / Nama baru tidak boleh kosong.');
      return;
    }

    setIsUpdating(true);
    setUpdateError('');

    try {
      const latVal =
        localGps?.available && typeof localGps.latitude === 'number'
          ? localGps.latitude
          : null;
      const lngVal =
        localGps?.available && typeof localGps.longitude === 'number'
          ? localGps.longitude
          : null;
      const latLngStr =
        latVal !== null && lngVal !== null
          ? `${latVal.toFixed(5)}, ${lngVal.toFixed(5)}`
          : '';
      const locationStr = localGps?.regionLabel || '';

      const metadataPayload = JSON.stringify({
        callsign: trimmedName,
        lat: latVal,
        lng: lngVal,
        lon: lngVal,
        latLng: latLngStr,
        dms: localGps?.dms || '',
        location: locationStr,
        region: locationStr,
        updatedAt: Date.now(),
      });

      if (localParticipant) {
        if (typeof localParticipant.updateName === 'function') {
          await localParticipant.updateName(trimmedName);
        } else if (typeof localParticipant.setName === 'function') {
          await localParticipant.setName(trimmedName);
        }

        if (typeof localParticipant.setMetadata === 'function') {
          await localParticipant.setMetadata(metadataPayload);
        }
      }

      onSuccessUpdateName(trimmedName);
      onClose();
    } catch (err) {
      console.error('Gagal memperbarui nama/metadata peserta:', err);
      // Tetap perbarui di sisi lokal meskipun server sedang sibuk
      onSuccessUpdateName(trimmedName);
      onClose();
    } finally {
      setIsUpdating(false);
    }
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
                SINKRONISASI REAL-TIME METADATA LIVEKIT
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

        <form onSubmit={handleSubmitNewName} className="space-y-3.5">
          <div>
            <label
              htmlFor="new-callsign-input"
              className="block text-xs font-bold uppercase tracking-wider text-sky-300 mb-1"
            >
              CALLSIGN / NAMA BARU
            </label>
            <input
              id="new-callsign-input"
              type="text"
              required
              autoFocus
              value={newNameInput}
              onChange={(e) => setNewNameInput(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/85 border border-sky-300/50 rounded-lg text-sky-100 focus:outline-none focus:border-cyan-300"
            />
          </div>

          {updateError && (
            <p className="text-xs text-red-300 bg-red-950/70 border border-red-400/50 rounded-lg px-3 py-2">
              {updateError}
            </p>
          )}

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
              disabled={isUpdating || !newNameInput.trim()}
              className="py-2.5 px-3 rounded-xl bg-sky-400 hover:bg-sky-300 disabled:opacity-40 text-slate-950 font-bold text-xs tracking-wider uppercase cursor-pointer"
            >
              {isUpdating ? 'MENYIMPAN...' : 'SIMPAN NAMA'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * ============================================================================
 * KOMPONEN REAL-TIME CHAT PANEL (DI ATAS GRID VIDEO)
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
            const metaSender = parseParticipantGpsMetadata(msg.from);
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
 * MODAL DAFTAR PERSONEL AKTIF, KOORDINAT GPS & INDIKATOR SINYAL
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
              ROOM: {roomName} · KOORDINAT LAT/LNG & WILAYAH ADMINISTRATIF
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
            const metaGps = parseParticipantGpsMetadata(p);
            const latLngCoord = p.isLocal
              ? localGps?.latLngText || metaGps?.latLng || metaGps?.dms
              : metaGps?.latLng ||
                (typeof metaGps?.lat === 'number' && typeof metaGps?.lng === 'number'
                  ? `${Number(metaGps.lat).toFixed(5)}, ${Number(metaGps.lng).toFixed(5)}`
                  : metaGps?.dms);
            const regionText = p.isLocal
              ? localGps?.regionLabel || metaGps?.location || metaGps?.region
              : metaGps?.location || metaGps?.region;
            const displayCallsign =
              metaGps?.callsign || p.name || (p.isLocal ? localCallsign : '') || p.identity;

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
                          ? 'SEDANG SHARE SCREEN'
                          : p.isSpeaking
                          ? 'SEDANG BERBICARA'
                          : 'STANDBY'}
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
                          GPS tidak tersedia / belum diizinkan
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
 * Menggunakan `<GridLayout />` dengan `<CustomParticipantTile />` yang memaksa
 * 2 kolom x 3 baris (min-h-[130px]) pada layar mobile agar 6 client muat utuh.
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
}) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  const connectionState = useConnectionState();

  // Ambil daftar track video (Camera & ScreenShare) untuk dirender di dalam <GridLayout />
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);
  const [showChangeNameModal, setShowChangeNameModal] = useState(false);

  // State untuk fitur Pindah Kamera (Depan / Belakang)
  const [activeCameraId, setActiveCameraId] = useState('');
  const [cameraFacingMode, setCameraFacingMode] = useState('user');
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);

  // Saat masuk ke IN_CALL, panggil `navigator.geolocation.getCurrentPosition()` melalui hook
  useEffect(() => {
    if (localGps?.refreshGps) {
      localGps.refreshGps();
    }
  }, [localGps?.refreshGps]);

  // Sinkronkan Callsign, Latitude, Longitude, & Lokasi Hasil Reverse Geocoding ke Metadata LiveKit
  useEffect(() => {
    if (!localParticipant || connectionState !== ConnectionState.Connected) {
      return;
    }

    const latVal =
      localGps?.available && typeof localGps.latitude === 'number'
        ? localGps.latitude
        : null;
    const lngVal =
      localGps?.available && typeof localGps.longitude === 'number'
        ? localGps.longitude
        : null;
    const latLngStr =
      latVal !== null && lngVal !== null
        ? `${latVal.toFixed(5)}, ${lngVal.toFixed(5)}`
        : '';
    const locationStr = localGps?.regionLabel || '';

    const metadataPayload = JSON.stringify({
      callsign: participantName,
      lat: latVal,
      lng: lngVal,
      lon: lngVal,
      latLng: latLngStr,
      dms: localGps?.dms || '',
      location: locationStr,
      region: locationStr,
    });

    const syncMetadataAndName = async () => {
      try {
        if (
          typeof localParticipant.setMetadata === 'function' &&
          localParticipant.metadata !== metadataPayload
        ) {
          await localParticipant.setMetadata(metadataPayload);
        }

        if (
          typeof localParticipant.setName === 'function' &&
          localParticipant.name !== participantName
        ) {
          await localParticipant.setName(participantName);
        }
      } catch (err) {
        console.warn('Sinkronisasi metadata GPS LiveKit tertunda:', err);
      }
    };

    syncMetadataAndName();
  }, [
    localParticipant,
    connectionState,
    participantName,
    localGps?.available,
    localGps?.latitude,
    localGps?.longitude,
    localGps?.dms,
    localGps?.regionLabel,
  ]);

  // Sinkronisasi Mode Hemat Bandwidth ke track kamera & video remote
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
   * FUNGSI PINDAH KAMERA (DEPAN / BELAKANG)
   */
  const handleSwitchCamera = useCallback(async () => {
    if (!room || isSwitchingCamera) return;
    setIsSwitchingCamera(true);

    try {
      if (!isCameraEnabled && localParticipant) {
        await localParticipant.setCameraEnabled(true);
      }

      const nextFacing = cameraFacingMode === 'user' ? 'environment' : 'user';
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');

      if (videoInputs.length > 1) {
        const targetByLabel = videoInputs.find((device) => {
          const label = (device.label || '').toLowerCase();
          if (nextFacing === 'environment') {
            return (
              label.includes('back') ||
              label.includes('rear') ||
              label.includes('environment') ||
              label.includes('belakang')
            );
          }
          return (
            label.includes('front') ||
            label.includes('user') ||
            label.includes('facetime') ||
            label.includes('depan')
          );
        });

        const currentCamPub = localParticipant?.getTrackPublication(Track.Source.Camera);
        const currentSettingsDeviceId =
          currentCamPub?.track?.mediaStreamTrack?.getSettings?.()?.deviceId || activeCameraId;

        let targetDevice = targetByLabel;

        if (!targetDevice || targetDevice.deviceId === currentSettingsDeviceId) {
          const currentIndex = videoInputs.findIndex(
            (d) => d.deviceId === currentSettingsDeviceId
          );
          const nextIndex = (currentIndex + 1) % videoInputs.length;
          targetDevice = videoInputs[nextIndex];
        }

        if (targetDevice && targetDevice.deviceId) {
          await room.switchActiveDevice('videoinput', targetDevice.deviceId);
          setActiveCameraId(targetDevice.deviceId);
          setCameraFacingMode(nextFacing);
          return;
        }
      }

      const camPub = localParticipant?.getTrackPublication(Track.Source.Camera);
      if (camPub?.track && typeof camPub.track.restartTrack === 'function') {
        await camPub.track.restartTrack({ facingMode: nextFacing });
        setCameraFacingMode(nextFacing);
      }
    } catch (err) {
      console.error('Gagal menukar kamera (switchActiveDevice):', err);
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [room, localParticipant, isCameraEnabled, cameraFacingMode, activeCameraId, isSwitchingCamera]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Renderer Audio Seluruh Peserta Room */}
      <RoomAudioRenderer />

      {/* 1. HEADER ATAS DENGAN LOGO TNI AU & INDIKATOR JARINGAN/GPS */}
      <LiveKitHeaderHUD
        roomName={roomName}
        participantName={participantName}
        lowBandwidthMode={lowBandwidthMode}
        localGps={localGps}
        onOpenQrModal={onOpenQrModal}
      />

      {/* 2. AREA TENGAH: <GridLayout /> (2 Kolom x 3 Baris min-h-[130px] di Mobile) + <CustomParticipantTile /> */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden bg-slate-900 p-1.5 sm:p-2.5">
        <GridLayout
          tracks={tracks}
          className="tactical-mobile-grid !h-full !w-full max-md:!grid max-md:!grid-cols-2 max-md:!grid-rows-3 gap-1.5 sm:gap-2.5"
        >
          <CustomParticipantTile
            localGps={localGps}
            localCallsign={participantName}
          />
        </GridLayout>

        {/* Watermark Taktis Transparan di Belakang */}
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

        <ChangeCallsignModal
          isOpen={showChangeNameModal}
          onClose={() => setShowChangeNameModal(false)}
          currentName={participantName}
          localGps={localGps}
          onSuccessUpdateName={onUpdateParticipantName}
        />
      </div>

      {/* 3. CUSTOM TACTICAL CONTROL BAR */}
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

          {/* TOMBOL SHARE SCREEN */}
          <TrackToggle
            source={Track.Source.ScreenShare}
            showIcon={true}
            className="lk-custom-screenshare-toggle flex items-center justify-center gap-1.5 !px-2.5 !py-2 sm:!px-3 !rounded-lg !border !border-sky-300/45 !bg-slate-900 hover:!bg-slate-800 !text-sky-300 !text-[10px] sm:!text-xs !font-bold !tracking-wider !uppercase transition-all cursor-pointer shrink-0"
          >
            <span>SHARE SCREEN</span>
          </TrackToggle>

          {/* TOMBOL PINDAH KAMERA (DEPAN / BELAKANG) */}
          <button
            type="button"
            onClick={handleSwitchCamera}
            disabled={isSwitchingCamera}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-cyan-300/50 bg-slate-900 hover:bg-slate-800 text-cyan-300 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 disabled:opacity-50"
            title="Tukar Kamera Depan (User) / Belakang (Environment)"
          >
            <SwitchCamera
              className={`w-4 h-4 shrink-0 ${isSwitchingCamera ? 'animate-spin' : ''}`}
            />
            <span>PINDAH KAMERA</span>
          </button>

          {/* 3. TOMBOL UBAH SANDI/NAMA SAAT RAPAT (IN-CALL) */}
          <button
            type="button"
            onClick={() => setShowChangeNameModal(true)}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-sky-300/55 bg-sky-400/15 hover:bg-sky-400/25 text-sky-200 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0"
            title="Ubah Callsign / Nama Personel Saat Rapat Berlangsung"
          >
            <Edit3 className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
            <span>UBAH SANDI/NAMA</span>
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

          {/* TOMBOL DAFTAR PERSONEL & GPS */}
          <button
            type="button"
            onClick={() => setShowParticipantsModal(true)}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3 rounded-lg border border-sky-300/40 bg-slate-900 hover:bg-slate-800 text-sky-200 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer shrink-0"
          >
            <Users className="w-4 h-4 text-sky-300 shrink-0" />
            <span>PERSONEL ({participants.length})</span>
          </button>

          {/* TOMBOL MODE HEMAT DATA / VOICE-ONLY */}
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

  // 1. KOSONGKAN CALLSIGN DI AWAL (LOGIN): Default callsign adalah "" (string kosong)
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

  // Hook Geolocation GPS + Reverse Geocoding Nominatim OpenStreetMap
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

      const latVal =
        localGps?.available && typeof localGps.latitude === 'number'
          ? localGps.latitude
          : null;
      const lngVal =
        localGps?.available && typeof localGps.longitude === 'number'
          ? localGps.longitude
          : null;
      const latLngStr =
        latVal !== null && lngVal !== null
          ? `${latVal.toFixed(5)}, ${lngVal.toFixed(5)}`
          : '';
      const locationStr = localGps?.regionLabel || '';

      const initialMetadata = JSON.stringify({
        callsign: finalCallsign,
        lat: latVal,
        lng: lngVal,
        lon: lngVal,
        latLng: latLngStr,
        dms: localGps?.dms || '',
        location: locationStr,
        region: locationStr,
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
      localGps?.latitude,
      localGps?.longitude,
      localGps?.dms,
      localGps?.regionLabel,
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
          {/* Header Lobby: Logo DISKOMLEKAU + Tulisan TACTICAL VIDCOMM DISKOMLEKAU + Logo TNI AU */}
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
                onClick={() => setShowQrModal(true)}
                className="px-3 py-1.5 rounded-lg bg-sky-400/15 hover:bg-sky-400/25 border border-sky-300/50 text-sky-300 text-xs font-bold tracking-wider uppercase flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              >
                <QrCode className="w-4 h-4 text-cyan-300" />
                <span className="hidden sm:inline">TAMPILKAN QR UNDANGAN</span>
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

              {/* Panel Status Koordinat GPS Personel (Tanpa Map) */}
              <div className="mb-3.5 px-3.5 py-2.5 rounded-xl bg-blue-950/80 border border-sky-300/35 flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                      TELEMETRI GPS HUD (TANPA MAP)
                    </span>
                    <span className="text-[10px] text-cyan-300 font-semibold">
                      {localGps.available ? 'GPS AKTIF' : localGps.status}
                    </span>
                  </div>
                  {localGps.available && localGps.latLngText ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="font-mono font-bold text-cyan-300 text-xs">
                        {localGps.latLngText} ({localGps.dms})
                      </p>
                      {localGps.regionLabel ? (
                        <p className="text-[11px] text-sky-200">{localGps.regionLabel}</p>
                      ) : (
                        <p className="text-[10px] text-slate-400">
                          Mendeteksi lokasi via Nominatim OpenStreetMap...
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Izinkan akses lokasi untuk menampilkan [CALLSIGN] | [LAT, LNG] | [LOKASI] pada HUD video.
                    </p>
                  )}
                </div>
              </div>

              <form onSubmit={handleJoinSubmit} className="space-y-3.5">
                {/* 1. INPUT CALLSIGN KOSONG DI AWAL TANPA PLACEHOLDER NAMA */}
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

                <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {/* TOMBOL GABUNG DISABLED JIKA CALLSIGN MASIH KOSONG */}
                  <button
                    type="submit"
                    disabled={isLoading || isCallsignEmpty}
                    className="w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase bg-sky-400 hover:bg-sky-300 text-slate-950 border border-cyan-300 shadow-[0_0_20px_rgba(56,189,248,0.3)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                  >
                    {isLoading ? 'MENGHUBUNGKAN...' : 'GABUNG'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowQrModal(true)}
                    className="w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase bg-blue-950 hover:bg-blue-900 text-sky-300 border border-sky-300/60 flex items-center justify-center gap-2 transition-all cursor-pointer"
                  >
                    <QrCode className="w-4 h-4 text-cyan-300 shrink-0" />
                    <span>TAMPILKAN QR UNDANGAN</span>
                  </button>
                </div>
              </form>

              <div className="mt-4 pt-3 border-t border-sky-300/20 flex items-center justify-between text-[10px] sm:text-[11px] text-blue-400">
                <span className="inline-flex items-center gap-1.5 text-sky-300 font-semibold">
                  <Lock className="w-3.5 h-3.5 text-cyan-300" />
                  END-TO-END WEBRTC · GPS TELEMETRY HUD
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
