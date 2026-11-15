/**
 * ============================================================================
 * FILE FRONTEND: src/App.jsx
 * TACTICAL VIDCOMM DISKOMLEKAU — 100% PRODUCTION WEBRTC LIVEKIT & PWA
 *
 * Fitur Utama:
 * 1. Koordinat GPS Real-Time Tanpa Map per Personel (Apabila Available):
 *    - Membaca GPS perangkat menggunakan `navigator.geolocation.watchPosition`.
 *    - Konversi otomatis ke format DMS Indonesia (contoh: `7°15'30" LS, 110°25'45" BT`).
 *    - Reverse Geocoding otomatis (Kecamatan, Kabupaten/Kota, Provinsi — contoh:
 *      `Makasar, Jakarta Timur, DKI Jakarta`).
 *    - Sinkronisasi ke masing-masing user di dalam Room menggunakan LiveKit Metadata
 *      (`localParticipant.setMetadata` & `localParticipant.setName`) sehingga tampil
 *      di kotak video masing-masing peserta, di HUD atas, dan di Daftar Personel.
 * 2. Logo TNI AU (Swa Bhuwana Paksa):
 *    - Ditampilkan di sebelah kanan tulisan "TACTICAL VIDCOMM DISKOMLEKAU" serta di
 *      pojok kanan atas antarmuka menggunakan gambar `/assets/aistudio/1792503945296_954409ac.jpg`.
 * 3. Default State Lobby ("ANU", Room "yes", Sandi "yes"), Share Screen (`<TrackToggle />`),
 *    Pindah Kamera Depan/Belakang (`room.switchActiveDevice`), Deep Link QR, & Real-Time Chat.
 * ============================================================================
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LiveKitRoom,
  VideoConference,
  ConnectionQualityIndicator,
  TrackToggle,
  useConnectionState,
  useRoomContext,
  useParticipants,
  useLocalParticipant,
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
  Navigation,
} from 'lucide-react';

// SETTING DEFAULT LOBBY (NILAI AWAL)
const DEFAULT_CALLSIGN = 'ANU';
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
 * Helper Ekstraksi Metadata GPS dari Participant LiveKit
 */
function parseParticipantGpsMetadata(participant) {
  if (!participant?.metadata) return null;
  try {
    const parsed = JSON.parse(participant.metadata);
    if (parsed && (parsed.dms || parsed.region)) {
      return parsed;
    }
  } catch {
    // Metadata bukan JSON
  }
  return null;
}

/**
 * ============================================================================
 * HOOK: REAL-TIME GEOLOCATION + REVERSE GEOCODING (TANPA MAP)
 * Mengambil koordinat GPS perangkat (jika diizinkan/available) serta nama
 * Kecamatan, Kabupaten/Kota, dan Provinsi secara otomatis.
 * ============================================================================
 */
function useTacticalGpsLocation() {
  const [gpsData, setGpsData] = useState({
    available: false,
    status: 'MENCARI SINYAL GPS...',
    latitude: null,
    longitude: null,
    accuracy: null,
    dms: '',
    kecamatan: '',
    kabupaten: '',
    provinsi: '',
    regionLabel: '',
  });

  const lastGeocodeCoordRef = useRef({ lat: null, lon: null });

  const reverseGeocodeCoordinates = useCallback(async (lat, lon) => {
    // Hindari request berulang jika posisi belum bergeser signifikan (< ~100m)
    if (
      lastGeocodeCoordRef.current.lat !== null &&
      Math.abs(lastGeocodeCoordRef.current.lat - lat) < 0.001 &&
      Math.abs(lastGeocodeCoordRef.current.lon - lon) < 0.001
    ) {
      return;
    }
    lastGeocodeCoordRef.current = { lat, lon };

    try {
      // 1. Coba OpenStreetMap Nominatim (Bahasa Indonesia)
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

        const cleanKec = rawKecamatan.replace(/^Kecamatan\s+/i, '').trim();
        const cleanKab = rawKabupaten.trim();
        const cleanProv = rawProvinsi.replace(/^(Provinsi|Daerah Khusus Ibukota)\s+/i, '').trim();

        const parts = [cleanKec, cleanKab, cleanProv].filter(Boolean);
        // Hilangkan duplikat berurutan
        const uniqueParts = parts.filter((item, idx) => parts.indexOf(item) === idx);
        const regionStr = uniqueParts.join(', ');

        if (regionStr) {
          setGpsData((prev) => ({
            ...prev,
            kecamatan: cleanKec,
            kabupaten: cleanKab,
            provinsi: cleanProv,
            regionLabel: regionStr,
          }));
          return;
        }
      }
    } catch {
      // Lanjut ke fallback kedua
    }

    try {
      // 2. Fallback: BigDataCloud Reverse Geocode Client API (Tanpa API Key)
      const fallbackRes = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=id`
      );
      if (fallbackRes.ok) {
        const fbData = await fallbackRes.json();
        const kec = (fbData.locality || '').replace(/^Kecamatan\s+/i, '').trim();
        const kab = (fbData.city || fbData.principalSubdivision || '').trim();
        const prov = (fbData.principalSubdivision || '').trim();

        const parts = [kec, kab, prov].filter(Boolean);
        const uniqueParts = parts.filter((item, idx) => parts.indexOf(item) === idx);
        const regionStr = uniqueParts.join(', ');

        if (regionStr) {
          setGpsData((prev) => ({
            ...prev,
            kecamatan: kec,
            kabupaten: kab,
            provinsi: prov,
            regionLabel: regionStr,
          }));
        }
      }
    } catch {
      // Biarkan hanya koordinat DMS jika offline
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGpsData((prev) => ({
        ...prev,
        available: false,
        status: 'GPS TIDAK TERSEDIA DI PERANGKAT',
      }));
      return;
    }

    const handleSuccess = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const dmsString = formatGpsToIndonesianDMS(latitude, longitude);

      setGpsData((prev) => ({
        ...prev,
        available: true,
        status: 'GPS LOCKED',
        latitude,
        longitude,
        accuracy: Math.round(accuracy || 0),
        dms: dmsString,
      }));

      reverseGeocodeCoordinates(latitude, longitude);
    };

    const handleError = (err) => {
      setGpsData((prev) => ({
        ...prev,
        available: false,
        status:
          err.code === 1
            ? 'IZIN GPS DITOLAK'
            : 'SINYAL GPS BELUM TERSEDIA',
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

  return gpsData;
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
      className={`relative flex items-center justify-center rounded-lg border border-sky-300/40 bg-blue-950/80 overflow-hidden shadow-[0_0_15px_rgba(56,189,248,0.15)] ${className}`}
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
 * Komponen Logo Resmi TNI AU — Swa Bhuwana Paksa (Sebelah Kanan Tulisan & Pojok Kanan Atas)
 */
function TniAuLogo({ className = 'w-9 h-9' }) {
  return (
    <div
      className={`relative flex items-center justify-center rounded-full border border-amber-400/60 bg-slate-950 overflow-hidden shadow-[0_0_15px_rgba(251,191,36,0.2)] shrink-0 ${className}`}
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
 * KOMPONEN HUD INDIKATOR JARINGAN & GPS DI HEADER ATAS (<LiveKitRoom>)
 * Menampilkan Logo DISKOMLEKAU + Tulisan TACTICAL VIDCOMM DISKOMLEKAU + Logo TNI AU
 * di sebelah kanannya serta di pojok kanan atas.
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
      {/* Kiri: Logo DISKOMLEKAU + Tulisan TACTICAL VIDCOMM DISKOMLEKAU + Logo TNI AU di Sebelah Kanannya */}
      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
        <TacticalRadarLogo className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-xs sm:text-sm md:text-base font-bold tracking-wider text-sky-300 truncate">
              TACTICAL VIDCOMM DISKOMLEKAU
            </h1>
            {/* Logo TNI AU tepat di sebelah kanan atas tulisan TACTICAL VIDCOMM DISKOMLEKAU */}
            <TniAuLogo className="w-6 h-6 sm:w-7 sm:h-7" />

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
            <span className="text-cyan-300 font-semibold">USER: {participantName}</span>
            {localGps?.available && localGps.dms && (
              <>
                <span className="text-blue-400 hidden md:inline">·</span>
                <span className="hidden md:inline-flex items-center gap-1 text-sky-200 font-mono text-[10px]">
                  <MapPin className="w-3 h-3 text-cyan-300 shrink-0" />
                  <span>{localGps.dms}</span>
                  {localGps.regionLabel && (
                    <span className="text-cyan-300">({localGps.regionLabel})</span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Kanan: Indikator Jaringan, QR, PWA Install, & Logo TNI AU Pojok Kanan Atas */}
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

        {/* Logo TNI AU di Pojok Kanan Atas */}
        <TniAuLogo className="w-8 h-8 sm:w-9 sm:h-9" />
      </div>
    </header>
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
    <aside className="absolute top-2 right-2 bottom-2 z-40 w-[calc(100%-1rem)] sm:w-88 md:w-96 bg-slate-900/95 backdrop-blur-md border border-sky-300/40 rounded-xl shadow-[0_0_35px_rgba(2,6,23,0.85)] flex flex-col overflow-hidden">
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
            const sender = msg.from?.name || msg.from?.identity || 'PERSONEL';
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
 * Menampilkan koordinat DMS + Kecamatan/Kabupaten/Provinsi masing-masing user
 * ============================================================================
 */
function RealTimeParticipantsModal({ isOpen, onClose, roomName, localGps }) {
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
              ROOM: {roomName} · KOORDINAT DMS & WILAYAH ADMINISTRATIF
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
            const dmsCoord = p.isLocal
              ? localGps?.dms || metaGps?.dms
              : metaGps?.dms;
            const regionText = p.isLocal
              ? localGps?.regionLabel || metaGps?.region
              : metaGps?.region;
            const displayCallsign = metaGps?.callsign || p.identity;

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

                      {/* Tampilan Koordinat GPS & Provinsi/Kabupaten/Kecamatan per User */}
                      {dmsCoord ? (
                        <div className="pt-1 text-[10px] font-mono text-sky-200 space-y-0.5">
                          <div className="flex items-center gap-1 text-cyan-300 font-bold">
                            <MapPin className="w-3 h-3 shrink-0" />
                            <span>{dmsCoord}</span>
                          </div>
                          {regionText && (
                            <div className="text-sky-300/90 pl-4">
                              {regionText}
                            </div>
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
 * Menyinkronkan Koordinat GPS + Wilayah (Kecamatan, Kabupaten/Kota, Provinsi)
 * ke metadata & label peserta LiveKit agar tampil pada masing-masing kotak video user.
 * ============================================================================
 */
function InCallWorkspace({
  roomName,
  participantName,
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

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);

  // State untuk fitur Pindah Kamera (Depan / Belakang)
  const [activeCameraId, setActiveCameraId] = useState('');
  const [cameraFacingMode, setCameraFacingMode] = useState('user');
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);

  // Sinkronkan Koordinat GPS & Wilayah Administratif ke LiveKit Participant Metadata & Name
  // sehingga setiap kotak video peserta (<VideoConference />) menampilkan Callsign + Koordinat DMS + Wilayah!
  useEffect(() => {
    if (
      !localParticipant ||
      connectionState !== ConnectionState.Connected ||
      !localGps?.available ||
      !localGps?.dms
    ) {
      return;
    }

    const syncGpsToLiveKit = async () => {
      try {
        const metadataPayload = JSON.stringify({
          callsign: participantName,
          dms: localGps.dms,
          region: localGps.regionLabel || '',
          lat: localGps.latitude,
          lon: localGps.longitude,
        });

        if (typeof localParticipant.setMetadata === 'function') {
          await localParticipant.setMetadata(metadataPayload);
        }

        // Format multi-baris pada tile video masing-masing user:
        // Baris 1: CALLSIGN | 7°15'30" LS, 110°25'45" BT
        // Baris 2: Makassar, Jakarta Timur (Kecamatan, Kabupaten/Kota, Provinsi)
        const formattedTileLabel = localGps.regionLabel
          ? `${participantName} · ${localGps.dms}\n${localGps.regionLabel}`
          : `${participantName} · ${localGps.dms}`;

        if (
          typeof localParticipant.setName === 'function' &&
          localParticipant.name !== formattedTileLabel
        ) {
          await localParticipant.setName(formattedTileLabel);
        }
      } catch (err) {
        console.warn('Sinkronisasi metadata GPS LiveKit tertunda:', err);
      }
    };

    syncGpsToLiveKit();
  }, [
    localParticipant,
    connectionState,
    participantName,
    localGps?.available,
    localGps?.dms,
    localGps?.regionLabel,
    localGps?.latitude,
    localGps?.longitude,
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
      {/* 1. HEADER ATAS DENGAN LOGO TNI AU & INDIKATOR JARINGAN/GPS */}
      <LiveKitHeaderHUD
        roomName={roomName}
        participantName={participantName}
        lowBandwidthMode={lowBandwidthMode}
        localGps={localGps}
        onOpenQrModal={onOpenQrModal}
      />

      {/* 2. AREA TENGAH: <VideoConference /> + HUD KOORDINAT GPS TIAP USER + CHAT */}
      <div className="flex-1 min-h-0 w-full relative overflow-hidden bg-slate-900">
        {/* Komponen <VideoConference /> bawaan LiveKit */}
        <VideoConference />

        {/* TOMBOL MELAYANG "PINDAH KAMERA" DI POJOK KANAN ATAS VIDEO */}
        <div className="absolute top-12 right-3 sm:top-14 sm:right-5 z-30 flex items-center gap-2">
          <button
            type="button"
            onClick={handleSwitchCamera}
            disabled={isSwitchingCamera}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-950/90 hover:bg-blue-900 active:scale-95 border border-sky-300/60 text-sky-200 shadow-[0_4px_20px_rgba(2,132,199,0.35)] text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer disabled:opacity-50"
            title="Pindah Kamera Depan / Belakang (room.switchActiveDevice)"
          >
            <SwitchCamera
              className={`w-4 h-4 text-cyan-300 shrink-0 ${
                isSwitchingCamera ? 'animate-spin' : ''
              }`}
            />
            <span>
              PINDAH KAMERA ({cameraFacingMode === 'user' ? 'DEPAN' : 'BELAKANG'})
            </span>
          </button>
        </div>

        {/* HUD OVERLAY TAKTIS: DAFTAR KOORDINAT GPS MASING-MASING USER (TANPA MAP) */}
        <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-4 overflow-hidden">
          <div className="flex items-start justify-between gap-2">
            {/* Panel Kiri Atas: Kartu Koordinat GPS Masing-Masing User yang Terhubung */}
            <div className="flex flex-col gap-1.5 max-w-[300px] sm:max-w-sm">
              {participants.slice(0, 4).map((p) => {
                const metaGps = parseParticipantGpsMetadata(p);
                const dms = p.isLocal ? localGps?.dms || metaGps?.dms : metaGps?.dms;
                const region = p.isLocal
                  ? localGps?.regionLabel || metaGps?.region
                  : metaGps?.region;
                const callsign = metaGps?.callsign || p.identity;

                return (
                  <ParticipantContextIfNeeded key={p.identity} participant={p}>
                    <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/85 backdrop-blur-xs border border-sky-300/35 text-[10px] text-sky-100 shadow-md">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-sky-300 uppercase truncate">
                          {callsign} {p.isLocal ? '(ANDA)' : ''}
                        </span>
                        <ConnectionQualityIndicator className="!p-0 !bg-transparent" />
                      </div>
                      {dms ? (
                        <div className="mt-0.5 font-mono leading-tight">
                          <div className="text-cyan-300 font-semibold flex items-center gap-1">
                            <Navigation className="w-2.5 h-2.5 text-cyan-300 shrink-0" />
                            <span>{dms}</span>
                          </div>
                          {region && (
                            <div className="text-[9px] text-sky-200/90 truncate pl-3.5">
                              {region}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-[9px] text-slate-400 mt-0.5">
                          {p.isLocal ? localGps?.status : 'Menunggu telemetri GPS...'}
                        </div>
                      )}
                    </div>
                  </ParticipantContextIfNeeded>
                );
              })}
            </div>

            {/* Badge Kanan Atas HUD */}
            <div className="px-2.5 py-1 rounded bg-blue-950/85 border border-sky-300/40 text-[9px] sm:text-[11px] font-bold tracking-widest text-sky-300 uppercase shadow-sm">
              CONFIDENTIAL - DISKOMLEKAU · {roomName}
            </div>
          </div>

          {/* Watermark Taktis Tengah */}
          <div className="flex items-center justify-center my-auto">
            <div className="text-center opacity-15 select-none">
              <p className="text-sm sm:text-xl md:text-2xl font-extrabold tracking-[0.28em] text-sky-300 uppercase">
                CONFIDENTIAL - DISKOMLEKAU
              </p>
              <p className="text-[10px] sm:text-xs tracking-[0.25em] text-cyan-300 uppercase mt-1">
                CALLSIGN: {participantName} · ROOM: {roomName}
              </p>
            </div>
          </div>

          {/* Sudut Bawah HUD */}
          <div className="flex items-end justify-between mb-12 sm:mb-14">
            <div className="w-4 h-4 border-l-2 border-b-2 border-sky-300/50" />
            <div className="w-4 h-4 border-r-2 border-b-2 border-sky-300/50" />
          </div>
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
        />
      </div>

      {/* 3. CUSTOM TACTICAL CONTROL BAR */}
      <div className="shrink-0 bg-blue-950/95 border-t border-sky-300/35 px-2.5 py-2 sm:px-5 flex items-center justify-between gap-2 z-30">
        <div className="hidden xl:flex items-center gap-2 text-xs text-sky-200">
          <span className="px-2.5 py-1 rounded-md bg-slate-900/90 border border-sky-300/30">
            ROOM: <strong className="text-sky-300">{roomName}</strong>
          </span>
          {localGps?.available && localGps.dms && (
            <span className="px-2.5 py-1 rounded-md bg-slate-900/90 border border-sky-300/30 font-mono text-[11px] text-cyan-300">
              {localGps.dms}
              {localGps.regionLabel ? ` — ${localGps.regionLabel}` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between xl:justify-end gap-1.5 sm:gap-2 w-full xl:w-auto overflow-x-auto no-scrollbar">
          {/* KOMPONEN RESMI <TrackToggle source={Track.Source.ScreenShare} /> DARI LIVEKIT */}
          <TrackToggle
            source={Track.Source.ScreenShare}
            showIcon={true}
            className="lk-custom-screenshare-toggle flex items-center justify-center gap-1.5 !px-2.5 !py-2 sm:!px-3.5 !rounded-lg !border !border-sky-300/45 !bg-slate-900 hover:!bg-slate-800 !text-sky-300 !text-[10px] sm:!text-xs !font-bold !tracking-wider !uppercase transition-all cursor-pointer shrink-0"
          >
            <span>SHARE SCREEN</span>
          </TrackToggle>

          {/* TOMBOL PINDAH KAMERA (DEPAN / BELAKANG) */}
          <button
            type="button"
            onClick={handleSwitchCamera}
            disabled={isSwitchingCamera}
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3.5 rounded-lg border border-cyan-300/50 bg-slate-900 hover:bg-slate-800 text-cyan-300 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 disabled:opacity-50"
            title="Tukar Kamera Depan (User) / Belakang (Environment)"
          >
            <SwitchCamera
              className={`w-4 h-4 shrink-0 ${isSwitchingCamera ? 'animate-spin' : ''}`}
            />
            <span>PINDAH KAMERA</span>
          </button>

          {/* TOMBOL CHAT REAL-TIME */}
          <button
            type="button"
            onClick={() => setIsChatOpen((prev) => !prev)}
            className={`relative flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3.5 rounded-lg border text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 ${
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
            className="flex items-center justify-center gap-1.5 px-2.5 py-2 sm:px-3.5 rounded-lg border border-sky-300/40 bg-slate-900 hover:bg-slate-800 text-sky-200 text-[10px] sm:text-xs font-bold tracking-wider uppercase transition-colors cursor-pointer shrink-0"
          >
            <Users className="w-4 h-4 text-sky-300 shrink-0" />
            <span>PERSONEL ({participants.length})</span>
          </button>

          {/* TOMBOL MODE HEMAT DATA / VOICE-ONLY */}
          <button
            type="button"
            onClick={() => onToggleLowBandwidth(!lowBandwidthMode)}
            className={`hidden sm:flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold tracking-wider uppercase transition-all cursor-pointer shrink-0 ${
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

  // SETTING DEFAULT LOBBY: Callsign = "ANU", Room = "yes", Sandi = "yes"
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

  // Hook Geolocation GPS + Provinsi/Kabupaten/Kecamatan (Tanpa Map)
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

      if (!finalRoom || !finalCallsign) {
        setErrorMsg('Harap isi Callsign dan Nama Room Operasi terlebih dahulu.');
        return false;
      }

      if (!finalSandi) {
        setErrorMsg('Harap isi Sandi Operasi terlebih dahulu.');
        return false;
      }

      setIsLoading(true);
      try {
        const response = await fetch('/api/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomName: finalRoom,
            participantName: finalCallsign,
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
    [customServerUrl]
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

  return (
    /* PEMBUNGKUS UTAMA: FULL SCREEN FIT TANPA SCROLLBAR */
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
          {/* Header Lobby: Logo DISKOMLEKAU + Tulisan TACTICAL VIDCOMM DISKOMLEKAU + Logo TNI AU di Sebelah Kanan & Pojok Kanan Atas */}
          <header className="shrink-0 bg-blue-950/95 border-b border-sky-300/30 px-4 py-2.5 sm:px-6 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <TacticalRadarLogo className="w-9 h-9 shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-xs sm:text-base md:text-lg font-bold tracking-wider text-sky-300 truncate">
                    TACTICAL VIDCOMM DISKOMLEKAU
                  </h1>
                  {/* Logo TNI AU di sebelah kanan atas tulisan TACTICAL VIDCOMM DISKOMLEKAU */}
                  <TniAuLogo className="w-7 h-7 sm:w-8 sm:h-8" />
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
                  <TniAuLogo className="w-9 h-9" />
                  <Radio className="w-6 h-6 text-blue-400 shrink-0" />
                </div>
              </div>

              {/* Panel Status Koordinat GPS Personel (Tanpa Map) */}
              <div className="mb-3.5 px-3.5 py-2.5 rounded-xl bg-blue-950/80 border border-sky-300/35 flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-cyan-300 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">
                      POSISI GPS PERSONEL (TANPA MAP)
                    </span>
                    <span className="text-[10px] text-cyan-300 font-semibold">
                      {localGps.available ? 'GPS AKTIF' : localGps.status}
                    </span>
                  </div>
                  {localGps.available && localGps.dms ? (
                    <div className="mt-1 space-y-0.5">
                      <p className="font-mono font-bold text-cyan-300 text-xs sm:text-sm">
                        {localGps.dms}
                      </p>
                      {localGps.regionLabel ? (
                        <p className="text-[11px] text-sky-200">
                          {localGps.regionLabel}
                        </p>
                      ) : (
                        <p className="text-[10px] text-slate-400">
                          Mendeteksi Kecamatan / Kabupaten / Provinsi...
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Izinkan akses lokasi browser untuk menampilkan koordinat DMS & wilayah administratif.
                    </p>
                  )}
                </div>
              </div>

              <form onSubmit={handleJoinSubmit} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="callsign-input"
                    className="block text-xs font-bold uppercase tracking-wider text-sky-300 mb-1"
                  >
                    CALLSIGN / NRP PERSONEL
                  </label>
                  <input
                    id="callsign-input"
                    type="text"
                    required
                    value={participantName}
                    onChange={(e) => setParticipantName(e.target.value)}
                    placeholder="ANU"
                    autoComplete="off"
                    className="w-full px-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/80 border border-sky-300/45 rounded-lg text-sky-200 placeholder-slate-500 focus:outline-none focus:border-cyan-300"
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
                      placeholder="yes"
                      autoComplete="off"
                      className="w-full px-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/80 border border-sky-300/45 rounded-lg text-cyan-300 placeholder-slate-500 focus:outline-none focus:border-cyan-300"
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
                        placeholder="yes"
                        autoComplete="off"
                        className="w-full pl-9 pr-3.5 py-2.5 text-sm font-bold tracking-wider bg-blue-950/80 border border-sky-300/45 rounded-lg text-sky-200 placeholder-slate-500 focus:outline-none focus:border-cyan-300"
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
                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full py-3 px-4 rounded-xl font-bold text-xs tracking-wider uppercase bg-sky-400 hover:bg-sky-300 text-slate-950 border border-cyan-300 shadow-[0_0_20px_rgba(56,189,248,0.3)] transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isLoading ? 'MENGHUBUNGKAN...' : 'GABUNG RAPAT VTC'}
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
                  END-TO-END WEBRTC · GPS TELEMETRY
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
