
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import L from 'leaflet';

// --- Types ---

interface ArtSpot {
  id: string;
  lat: number;
  lng: number;
  title: string;
  description: string;
  images: string[]; // Base64 strings
  coverIndex: number;
  createdAt: number;
}

interface UserSession {
  isAuthenticated: boolean;
}

// --- Utils ---

// Simple ID generator
const generateId = () => Math.random().toString(36).substr(2, 9);

// Compress image to avoid large storage usage (IndexedDB handles more, but good to be efficient)
const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; // Increased slightly for DB
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.7)); 
        } else {
            reject(new Error("Canvas context is null"));
        }
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// --- IndexedDB Layer ---

const DB_NAME = 'StreetArtDB';
const STORE_NAME = 'spots';
const DB_VERSION = 1;

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

const dbAPI = {
  getAll: async (): Promise<ArtSpot[]> => {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Error getAll:", e);
      return [];
    }
  },
  save: async (spot: ArtSpot): Promise<void> => {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(spot);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Error save:", e);
    }
  },
  delete: async (id: string): Promise<void> => {
    try {
      const db = await initDB();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.error("DB Error delete:", e);
    }
  }
};

// --- Components ---

// 1. Confirmation Modal
const ConfirmationModal = ({ isOpen, onClose, onConfirm }: { isOpen: boolean; onClose: () => void; onConfirm: () => void }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      ></div>
      
      {/* Modal Content */}
      <div className="relative z-10 bg-urban-900 border border-urban-600 rounded-xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-red-950/50 text-red-500 flex items-center justify-center mx-auto mb-4 border border-red-900 shadow-[0_0_15px_rgba(220,38,38,0.3)]">
            <i className="fa-solid fa-triangle-exclamation text-2xl"></i>
          </div>
          <h3 className="text-xl font-bold text-white mb-2 tracking-wide">Уничтожить метку?</h3>
          <p className="text-urban-500 text-sm leading-relaxed">
            Это действие нельзя отменить. Метка и все связанные с ней фотографии будут удалены из базы данных.
          </p>
        </div>
        
        <div className="flex gap-3">
          <button 
            onClick={onClose} 
            className="flex-1 py-3 rounded-lg bg-urban-800 text-urban-300 hover:text-white hover:bg-urban-700 transition-colors font-medium border border-transparent hover:border-urban-600"
          >
            Отмена
          </button>
          <button 
            onClick={onConfirm} 
            className="flex-1 py-3 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-all font-bold shadow-lg shadow-red-900/40 hover:shadow-red-900/60 active:scale-95 border border-red-500"
          >
            Удалить
          </button>
        </div>
      </div>
    </div>
  );
};

// 2. Authorization / Welcome Screen
const AuthScreen = ({ onEnter }: { onEnter: () => void }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-urban-950 bg-[url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2070&auto=format&fit=crop')] bg-cover bg-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm"></div>
      <div className="relative z-10 p-8 max-w-md w-full bg-urban-900/90 border border-urban-700 rounded-2xl shadow-2xl text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-urban-accent flex items-center justify-center shadow-[0_0_20px_rgba(0,230,118,0.5)]">
            <i className="fa-solid fa-spray-can text-urban-900 text-3xl"></i>
          </div>
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">StreetArt Map</h1>
        <p className="text-urban-500 mb-8">Исследуй, отмечай и делись уличным искусством анонимно. Город - твоя галерея.</p>
        
        <button 
          onClick={onEnter}
          className="w-full py-4 bg-urban-accent hover:bg-urban-accentHover text-urban-900 font-bold rounded-xl transition-all transform hover:scale-105 shadow-lg active:scale-95 flex items-center justify-center gap-2"
        >
          <span>Войти в андеграунд</span>
          <i className="fa-solid fa-arrow-right"></i>
        </button>
        <p className="mt-4 text-xs text-urban-600">Все метки публичные. База данных локальная.</p>
      </div>
    </div>
  );
};

// 3. Main Map Component
const App = () => {
  const [session, setSession] = useState<UserSession>(() => {
    return localStorage.getItem('streetart_session') ? { isAuthenticated: true } : { isAuthenticated: false };
  });

  const [spots, setSpots] = useState<ArtSpot[]>([]);
  const [selectedSpotId, setSelectedSpotId] = useState<string | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Confirmation Modal State
  const [spotToDelete, setSpotToDelete] = useState<string | null>(null);

  // AI State
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Refs for Map
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<{ [key: string]: L.Marker }>({});

  // --- Effects ---

  // Load spots from IndexedDB
  useEffect(() => {
    const loadSpots = async () => {
      const data = await dbAPI.getAll();
      setSpots(data);
      
      // Migration check (optional): if localstorage has spots but DB is empty
      const lsSpots = localStorage.getItem('streetart_spots');
      if (data.length === 0 && lsSpots) {
        try {
          const parsed = JSON.parse(lsSpots);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.log("Migrating spots from LocalStorage to IndexedDB...");
            for (const s of parsed) {
              await dbAPI.save(s);
            }
            setSpots(parsed);
            localStorage.removeItem('streetart_spots'); // Cleanup
          }
        } catch (e) {
          console.error("Migration failed", e);
        }
      }
    };
    loadSpots();
  }, []);

  // Persist session
  useEffect(() => {
    if (session.isAuthenticated) {
      localStorage.setItem('streetart_session', 'true');
    }
  }, [session]);

  // Initialize Map
  useEffect(() => {
    if (!session.isAuthenticated) return;
    if (mapRef.current) return;

    // Default center (Moscow for demo, or get geolocation)
    const defaultCenter: [number, number] = [55.7558, 37.6173]; 
    
    const map = L.map('map-container', {
      zoomControl: false,
      attributionControl: false
    }).setView(defaultCenter, 13);

    // Dark Map Style (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Force map to recalculate size after render to fix "half grey" issue
    setTimeout(() => {
      map.invalidateSize();
    }, 100);

    // Check geolocation after map init
    if (navigator.geolocation) {
       navigator.geolocation.getCurrentPosition((pos) => {
         // Only set view if map still exists
         if (map) {
             map.setView([pos.coords.latitude, pos.coords.longitude], 14);
         }
       });
    }

    // Map Click -> Create Spot
    map.on('click', (e) => {
      // Don't create spot if clicking on a marker
      const target = e.originalEvent.target as HTMLElement;
      if (target.closest('.leaflet-marker-icon')) return;

      const popup = L.popup()
        .setLatLng(e.latlng)
        .setContent(`
          <div class="text-center p-2 font-sans">
            <p class="text-slate-900 font-bold mb-2 text-sm">Новый арт здесь?</p>
            <button id="create-spot-btn" class="bg-[#00e676] text-slate-900 px-3 py-1 rounded text-xs font-bold shadow hover:bg-[#00c853]">
              ОТМЕТИТЬ
            </button>
          </div>
        `)
        .openOn(map);

      // Handle button click inside popup
      setTimeout(() => {
        const btn = document.getElementById('create-spot-btn');
        if (btn) {
          btn.onclick = async () => {
            const newSpot: ArtSpot = {
              id: generateId(),
              lat: e.latlng.lat,
              lng: e.latlng.lng,
              title: "Новый спот",
              description: "",
              images: [],
              coverIndex: 0,
              createdAt: Date.now()
            };
            
            // Save to DB
            await dbAPI.save(newSpot);
            
            setSpots(prev => [...prev, newSpot]);
            setSelectedSpotId(newSpot.id);
            setSidebarOpen(true);
            setIsEditing(true);
            map.closePopup();
          };
        }
      }, 100);
    });

    mapRef.current = map;

    return () => {
      if (mapRef.current) {
          mapRef.current.remove();
          mapRef.current = null;
      }
    };
  }, [session.isAuthenticated]);

  // Sync Markers with State
  useEffect(() => {
    if (!mapRef.current) return;

    // Add/Update markers
    spots.forEach(spot => {
      const isSelected = selectedSpotId === spot.id;
      const hasImage = spot.images.length > 0;
      const coverImage = hasImage ? spot.images[spot.coverIndex] || spot.images[0] : null;

      // Construct HTML for the marker
      let htmlContent = '';
      let style = '';
      
      if (coverImage) {
        style = `background-image: url('${coverImage}')`;
      } else {
         htmlContent = `<i class="fa-solid fa-spray-can"></i>`;
      }

      const icon = L.divIcon({
        className: '', // We set classes in the HTML string to have full control or use clean divIcon
        html: `<div class="custom-marker-pin ${isSelected ? 'selected' : ''}" style="${style}">${htmlContent}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 20]
      });

      if (!markersRef.current[spot.id]) {
        // Create new marker
        const marker = L.marker([spot.lat, spot.lng], { icon }).addTo(mapRef.current!);
        
        marker.on('click', (e) => {
          L.DomEvent.stopPropagation(e); // Stop click from hitting the map
          setSelectedSpotId(spot.id);
          setSidebarOpen(true);
          setIsEditing(false);
          
          // Center map on marker slightly offset to fit sidebar
          if (mapRef.current) {
            mapRef.current.flyTo([spot.lat, spot.lng], 16, { duration: 0.8 });
          }
        });

        markersRef.current[spot.id] = marker;
      } else {
        // Update existing marker icon (to refresh image/selection state)
        markersRef.current[spot.id].setIcon(icon);
        markersRef.current[spot.id].setLatLng([spot.lat, spot.lng]);
        
        // Ensure z-index is correct (selected on top)
        markersRef.current[spot.id].setZIndexOffset(isSelected ? 1000 : 0);
      }
    });

    // Remove deleted markers
    Object.keys(markersRef.current).forEach(id => {
      if (!spots.find(s => s.id === id)) {
        if (markersRef.current[id]) {
            markersRef.current[id].remove();
            delete markersRef.current[id];
        }
      }
    });

  }, [spots, selectedSpotId]);


  // --- Logic ---

  const activeSpot = useMemo(() => spots.find(s => s.id === selectedSpotId), [spots, selectedSpotId]);

  const handleUpdateSpot = async (updates: Partial<ArtSpot>) => {
    if (!selectedSpotId) return;
    
    // Optimistic Update
    setSpots(prev => prev.map(s => {
      if (s.id === selectedSpotId) {
        const updated = { ...s, ...updates };
        // Fire and forget save to DB
        dbAPI.save(updated);
        return updated;
      }
      return s;
    }));
  };

  const handleRequestDelete = (id: string) => {
    setSpotToDelete(id);
  };

  const executeDelete = async () => {
    if (!spotToDelete) return;
    
    const id = spotToDelete;

    // 1. Update DB
    await dbAPI.delete(id);

    // 2. Imperative remove for instant feedback on map
    const marker = markersRef.current[id];
    if (marker) {
      marker.remove();
      delete markersRef.current[id];
    }

    // 3. Update state
    setSpots(prev => prev.filter(s => s.id !== id));
    
    // 4. UI cleanup
    if (selectedSpotId === id) {
      setSelectedSpotId(null);
      setSidebarOpen(false);
      setIsEditing(false);
    }

    setSpotToDelete(null);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !selectedSpotId) return;
    const files = Array.from(e.target.files) as File[];
    
    // Process files
    const newImages: string[] = [];
    for (const file of files) {
      try {
        const base64 = await compressImage(file);
        newImages.push(base64);
      } catch (err) {
        console.error("Image upload failed", err);
      }
    }

    if (activeSpot) {
      handleUpdateSpot({ images: [...activeSpot.images, ...newImages] });
    }
  };

  const handleGeminiDescription = async () => {
    if (!activeSpot || activeSpot.images.length === 0) return;
    
    setIsAnalyzing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const coverImage = activeSpot.images[activeSpot.coverIndex] || activeSpot.images[0];
      const base64Data = coverImage.split(',')[1]; 

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Data
              }
            },
            {
              text: "Ты эксперт по уличному искусству. Проанализируй это изображение. Опиши стиль (граффити, мурал, тэг, инсталляция), основные цвета, настроение и то, что изображено. Напиши краткое, но яркое описание (до 300 символов) для карты стрит-арта. Не используй фраз 'на этом изображении'. Сразу к делу."
            }
          ]
        }
      });

      if (response.text) {
        handleUpdateSpot({ description: response.text });
      }
    } catch (e) {
      console.error("Gemini Error:", e);
      alert("Не удалось сгенерировать описание. Попробуйте еще раз.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (!session.isAuthenticated) {
    return <AuthScreen onEnter={() => setSession({ isAuthenticated: true })} />;
  }

  return (
    <div className="fixed inset-0 overflow-hidden font-sans bg-urban-950">
      {/* Map Container - Always full screen */}
      <div id="map-container" className="fixed inset-0 z-0"></div>

      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 p-4 pointer-events-none">
        <div className="flex justify-between items-start">
          <div className="glass-panel px-4 py-2 rounded-full shadow-lg pointer-events-auto flex items-center gap-3">
             <i className="fa-solid fa-map text-urban-accent"></i>
             <span className="font-bold text-white tracking-wider">STREET<span className="text-urban-accent">ART</span> MAP</span>
          </div>
        </div>
      </div>

      {/* Sidebar (Details/Edit) */}
      <div 
        className={`absolute z-30 transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-y-0 md:translate-x-0' : 'translate-y-[110%] md:translate-x-[-110%] md:translate-y-0'}
          bottom-0 left-0 w-full md:w-[400px] md:top-0 md:h-full
          glass-panel md:border-r border-t border-urban-700
          flex flex-col shadow-2xl max-h-[85vh] md:max-h-full
        `}
      >
        {activeSpot ? (
          <>
            {/* Sidebar Header */}
            <div className="p-4 border-b border-urban-700 flex justify-between items-center bg-urban-900/50 rounded-t-2xl md:rounded-none">
              <button 
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-urban-500 hover:text-white transition-colors"
              >
                <i className="fa-solid fa-chevron-left md:hidden mr-1"></i>
                <i className="fa-solid fa-xmark hidden md:inline text-xl"></i>
                <span className="md:hidden">Карта</span>
              </button>
              
              <div className="flex gap-2">
                {!isEditing ? (
                  <button 
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="w-8 h-8 rounded-full bg-urban-800 hover:bg-urban-700 flex items-center justify-center text-urban-accent transition-colors"
                    title="Редактировать"
                  >
                    <i className="fa-solid fa-pen"></i>
                  </button>
                ) : (
                  <button 
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className="px-3 py-1 rounded bg-urban-accent text-urban-900 font-bold text-sm"
                  >
                    Готово
                  </button>
                )}
              </div>
            </div>

            {/* Sidebar Content */}
            <div className="flex-1 overflow-y-auto p-0 scrollbar-hide bg-urban-900">
              
              {/* Cover Image */}
              <div className="relative h-56 bg-urban-950 w-full group">
                {activeSpot.images.length > 0 ? (
                  <img 
                    src={activeSpot.images[activeSpot.coverIndex] || activeSpot.images[0]} 
                    className="w-full h-full object-cover" 
                    alt="Art"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-urban-600">
                    <i className="fa-solid fa-image text-4xl mb-2"></i>
                    <p>Нет фото</p>
                  </div>
                )}
                
                {/* Image Overlay Gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-urban-900 via-transparent to-transparent opacity-80"></div>
                
                <h2 className="absolute bottom-4 left-4 right-4 text-2xl font-bold text-white drop-shadow-lg">
                  {isEditing ? (
                     <input 
                      type="text" 
                      value={activeSpot.title}
                      onChange={(e) => handleUpdateSpot({ title: e.target.value })}
                      className="w-full bg-transparent border-b border-urban-accent outline-none text-white placeholder-urban-500 focus:border-urban-accentHover"
                      placeholder="Название места"
                    />
                  ) : activeSpot.title}
                </h2>
              </div>

              <div className="p-6 space-y-6">
                
                {/* Description */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-bold text-urban-500 uppercase tracking-widest">Описание</h3>
                    {isEditing && activeSpot.images.length > 0 && (
                      <button 
                        type="button"
                        onClick={handleGeminiDescription}
                        disabled={isAnalyzing}
                        className="text-xs bg-urban-highlight/20 text-urban-highlight px-2 py-1 rounded border border-urban-highlight hover:bg-urban-highlight hover:text-white transition-all flex items-center gap-1"
                      >
                         {isAnalyzing ? <i className="fa-solid fa-circle-notch fa-spin"></i> : <i className="fa-solid fa-wand-magic-sparkles"></i>}
                         {isAnalyzing ? 'Анализ...' : 'AI Описание'}
                      </button>
                    )}
                  </div>
                  
                  {isEditing ? (
                    <textarea 
                      value={activeSpot.description}
                      onChange={(e) => handleUpdateSpot({ description: e.target.value })}
                      className="w-full h-32 bg-urban-800 border border-urban-600 rounded-lg p-3 text-sm text-white focus:border-urban-accent focus:outline-none transition-colors resize-none"
                      placeholder="Расскажите об этом месте. Кто автор? Когда появилось? Какой смысл?"
                    />
                  ) : (
                    <p className="text-gray-300 leading-relaxed text-sm whitespace-pre-line">
                      {activeSpot.description || <span className="italic text-urban-600">Описание отсутствует...</span>}
                    </p>
                  )}
                </div>

                {/* Gallery */}
                <div className="space-y-2">
                  <h3 className="text-xs font-bold text-urban-500 uppercase tracking-widest flex justify-between">
                    <span>Галерея ({activeSpot.images.length})</span>
                    {isEditing && (
                      <label className="cursor-pointer text-urban-accent hover:text-white transition-colors">
                        <i className="fa-solid fa-plus mr-1"></i> Добавить
                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                    )}
                  </h3>
                  
                  <div className="grid grid-cols-3 gap-2">
                    {activeSpot.images.map((img, idx) => (
                      <div 
                        key={idx} 
                        className={`relative aspect-square rounded-lg overflow-hidden cursor-pointer border-2 ${activeSpot.coverIndex === idx ? 'border-urban-accent' : 'border-transparent'}`}
                        onClick={() => handleUpdateSpot({ coverIndex: idx })}
                      >
                        <img src={img} className="w-full h-full object-cover hover:scale-110 transition-transform duration-300" />
                        {isEditing && (
                          <button 
                            type="button"
                            className="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-500 z-10"
                            onClick={(e) => {
                              e.stopPropagation();
                              const newImages = activeSpot.images.filter((_, i) => i !== idx);
                              const newCoverIndex = activeSpot.coverIndex >= newImages.length ? 0 : activeSpot.coverIndex;
                              handleUpdateSpot({ images: newImages, coverIndex: newCoverIndex });
                            }}
                          >
                            <i className="fa-solid fa-times"></i>
                          </button>
                        )}
                        {activeSpot.coverIndex === idx && (
                          <div className="absolute bottom-0 left-0 right-0 bg-urban-accent text-urban-900 text-[10px] font-bold text-center py-0.5 z-10">
                            COVER
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {/* Empty State for Gallery if Editing */}
                    {isEditing && (
                      <label className="aspect-square rounded-lg border-2 border-dashed border-urban-600 flex flex-col items-center justify-center text-urban-600 hover:text-urban-accent hover:border-urban-accent cursor-pointer transition-colors bg-urban-800/50">
                        <i className="fa-solid fa-camera text-xl mb-1"></i>
                        <span className="text-xs">Загрузить</span>
                        <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
                      </label>
                    )}
                  </div>
                </div>

                {/* Meta Info */}
                <div className="pt-4 border-t border-urban-800 text-xs text-urban-600 flex justify-between">
                  <span>ID: {activeSpot.id}</span>
                  <span>{new Date(activeSpot.createdAt).toLocaleDateString()}</span>
                </div>
                
                {isEditing && (
                  <div className="pt-6 mt-6 border-t border-urban-800">
                    <button 
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleRequestDelete(activeSpot.id);
                      }}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-red-900/50 bg-red-950/20 text-red-500 hover:bg-red-600 hover:text-white hover:border-red-600 transition-all text-sm font-medium group"
                    >
                      <i className="fa-solid fa-trash-can group-hover:animate-bounce"></i> Уничтожить метку
                    </button>
                    <p className="text-center text-[10px] text-urban-600 mt-2">Действие нельзя отменить</p>
                  </div>
                )}

              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full text-urban-600 bg-urban-900">
            <p>Выберите метку на карте</p>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal 
        isOpen={!!spotToDelete} 
        onClose={() => setSpotToDelete(null)} 
        onConfirm={executeDelete} 
      />

    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
