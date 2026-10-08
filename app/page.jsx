'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import JSZip from 'jszip';
import { 
  Sparkles, Users, Crown, Utensils, HardHat, Tag, Upload, 
  Search, Eye, Trash2, Camera, ChevronRight, ChevronLeft, 
  ChevronDown, Sliders, RotateCcw, FileDown, CheckCircle, 
  AlertTriangle, PlusCircle, X, Image as ImageIcon, MessageSquare
} from 'lucide-react';
import { parseWhatsAppChat, getBasePhotoKeys, matchPhotoInCollection } from '../lib/parser';
import { renderCardOnCanvas, generateCardsPdf } from '../lib/cardRenderer';

const DEFAULT_CATEGORIES = [
  'ALL',
  'FAMILY',
  'AAA',
  'FOOD COURT',
  'GROUND ACCESS',
  'LABOR',
  'PHOTOGRAPHER',
  'DECOR',
  'BOX OFFICE',
  'CREW',
  'PARKING'
];

const DEFAULT_CONFIG = {
  photoX: 275,
  photoY: 576,
  photoW: 366,
  photoH: 406,
  nameY: 1065,
  nameFontSize: 40,
  nameColor: '#992A20',
  photoPosition: 'contain',
  photoShiftY: 0,
  photoShiftX: 0,
  photoZoom: 100
};

export default function Home() {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [activeCategory, setActiveCategory] = useState('FAMILY');
  const [records, setRecords] = useState([]);
  
  // Store photos in memory: Map(key -> { fileName, url, blob })
  const [photosMap, setPhotosMap] = useState(new Map());
  const [availablePhotosList, setAvailablePhotosList] = useState([]);
  
  // Custom templates: Map(category -> HTMLImageElement)
  const [templateImgs, setTemplateImgs] = useState(new Map());
  const [templateNames, setTemplateNames] = useState(new Map());
  
  // Category configs: Map(category -> config)
  const [categoryConfigs, setCategoryConfigs] = useState(new Map());

  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [tableSearch, setTableSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  
  // Drawer & modal states
  const [adjustDrawerOpen, setAdjustDrawerOpen] = useState(false);
  const [addCatModalOpen, setAddCatModalOpen] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');
  
  // Searchable photo picker state
  const [pickerState, setPickerState] = useState({
    isOpen: false,
    recordId: null,
    position: { top: 0, left: 0 },
    query: ''
  });
  const pickerInputRef = useRef(null);

  // Progress state
  const [progress, setProgress] = useState({
    active: false,
    current: 0,
    total: 0,
    percent: 0,
    message: ''
  });

  const liveCanvasRef = useRef(null);
  const fileInputChatRef = useRef(null);
  const fileInputZipRef = useRef(null);
  const fileInputTemplateRef = useRef(null);
  const singlePhotoFileInputRef = useRef(null);

  // Current category config (global for template position/size)
  const currentConfig = useMemo(() => {
    return categoryConfigs.get(activeCategory) || { ...DEFAULT_CONFIG };
  }, [categoryConfigs, activeCategory]);

  const updateCurrentConfig = (newConfig) => {
    setCategoryConfigs(prev => {
      const next = new Map(prev);
      next.set(activeCategory, { ...(prev.get(activeCategory) || DEFAULT_CONFIG), ...newConfig });
      return next;
    });
  };


  // Revalidate records matching against photosMap
  const validateRecord = (rec, pMap) => {
    const target = (rec.photoFileName || '').trim();
    if (!target) {
      return { ...rec, isFound: false, photoItem: null };
    }
    const matched = matchPhotoInCollection(target, pMap);
    return {
      ...rec,
      isFound: !!matched,
      photoItem: matched
    };
  };

  // Update records whenever photosMap changes
  useEffect(() => {
    setRecords(prev => prev.map(r => validateRecord(r, photosMap)));
  }, [photosMap]);

  // Filtered records for current active category and table search
  const categoryRecords = useMemo(() => {
    return records.filter(r => activeCategory === 'ALL' || r.category === activeCategory);
  }, [records, activeCategory]);

  const filteredRecords = useMemo(() => {
    const q = tableSearch.toLowerCase().trim();
    return categoryRecords.filter(r => {
      const matchSearch = !q || 
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.photoFileName && r.photoFileName.toLowerCase().includes(q));

      let matchStatus = true;
      if (statusFilter === 'FOUND') matchStatus = r.isFound;
      if (statusFilter === 'MISSING') matchStatus = !r.isFound;

      return matchSearch && matchStatus;
    });
  }, [categoryRecords, tableSearch, statusFilter]);

  const stats = useMemo(() => {
    const matched = categoryRecords.filter(r => r.isFound).length;
    const missing = categoryRecords.filter(r => !r.isFound).length;
    return {
      total: categoryRecords.length,
      matched,
      missing,
      photosCount: availablePhotosList.length
    };
  }, [categoryRecords, availablePhotosList]);

  // Selected record for Live Preview
  const selectedRecord = useMemo(() => {
    if (categoryRecords.length === 0) return null;
    return categoryRecords[currentPreviewIndex % categoryRecords.length] || categoryRecords[0];
  }, [categoryRecords, currentPreviewIndex]);

  // Effective config for the SELECTED record (personal overrides category defaults)
  // This merges category config + record's personal config
  const selectedEffectiveConfig = useMemo(() => {
    const base = categoryConfigs.get(activeCategory) || { ...DEFAULT_CONFIG };
    if (!selectedRecord?.config) return base;
    return { ...base, ...selectedRecord.config };
  }, [categoryConfigs, activeCategory, selectedRecord]);

  // Update only the selected record's personal config (not global)
  const updateSelectedRecordConfig = (newConfig) => {
    if (!selectedRecord) return;
    setRecords(prev => prev.map(r => {
      if (r.id === selectedRecord.id) {
        const cfg = r.config || {};
        return { ...r, config: { ...cfg, ...newConfig } };
      }
      return r;
    }));
  };

  // Render live preview card whenever selected record or config changes
  useEffect(() => {
    if (!liveCanvasRef.current) return;
    const canvas = liveCanvasRef.current;
    if (!selectedRecord) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#100A0A';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const tImg = templateImgs.get(selectedRecord.category) || templateImgs.get('ALL') || null;

    let pImg = null;
    if (selectedRecord.photoItem && selectedRecord.photoItem.url) {
      const img = new Image();
      img.src = selectedRecord.photoItem.url;
      img.onload = () => {
        renderCardOnCanvas(canvas, selectedRecord, tImg, currentConfig, img);
      };
      return;
    }

    renderCardOnCanvas(canvas, selectedRecord, tImg, currentConfig, null);
  }, [selectedRecord, currentConfig, templateImgs]);

  // Handle WhatsApp Chat Upload
  const handleChatUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseWhatsAppChat(text, activeCategory === 'ALL' ? 'FAMILY' : activeCategory);
    
    setRecords(prev => {
      const newRecs = parsed.map((p, idx) => validateRecord({
        ...p,
        category: activeCategory === 'ALL' ? 'FAMILY' : activeCategory,
        rowNumber: idx + 1
      }, photosMap));
      return newRecs;
    });

    setCurrentPreviewIndex(0);
    alert(`Successfully parsed ${parsed.length} name and photo records from chat!`);
  };

  // Handle Photos ZIP Upload (Client-Side JSZip)
  const handleZipUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProgress({ active: true, current: 0, total: 100, percent: 10, message: 'Unzipping photos in browser...' });

    try {
      const zip = await JSZip.loadAsync(file);
      const newMap = new Map(photosMap);
      const uniqueNames = new Set(availablePhotosList);
      const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir && /\.(jpg|jpeg|png|webp|heic|heif)$/i.test(name));
      
      let count = 0;
      for (const relativePath of entries) {
        const fileData = await zip.files[relativePath].async('blob');
        const fileName = relativePath.split('/').pop();
        const url = URL.createObjectURL(fileData);
        const item = { fileName, url, blob: fileData };
        
        uniqueNames.add(fileName);
        const keys = getBasePhotoKeys(fileName);
        for (const k of keys) {
          newMap.set(k, item);
        }
        count++;
        setProgress({ 
          active: true, 
          current: count, 
          total: entries.length, 
          percent: Math.round((count / entries.length) * 100), 
          message: `Loaded ${count} / ${entries.length} photos...` 
        });
      }

      setPhotosMap(newMap);
      setAvailablePhotosList(Array.from(uniqueNames));
      setProgress({ active: false, current: 0, total: 0, percent: 0, message: '' });
      alert(`Loaded ${count} photos directly into browser studio!`);
    } catch (err) {
      alert('Error extracting ZIP: ' + err.message);
      setProgress({ active: false, current: 0, total: 0, percent: 0, message: '' });
    }
  };

  // Handle Custom Design Template Upload
  const handleTemplateUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    img.onload = () => {
      setTemplateImgs(prev => {
        const next = new Map(prev);
        next.set(activeCategory, img);
        return next;
      });
      setTemplateNames(prev => {
        const next = new Map(prev);
        next.set(activeCategory, file.name);
        return next;
      });
      alert(`Custom template uploaded for category: ${activeCategory}!`);
    };
  };

  // Handle Single Photo Upload for a specific record
  const handleSinglePhotoUpload = (recId, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const item = { fileName: file.name, url, blob: file };

    setPhotosMap(prev => {
      const next = new Map(prev);
      const keys = getBasePhotoKeys(file.name);
      for (const k of keys) {
        next.set(k, item);
      }
      return next;
    });

    setAvailablePhotosList(prev => {
      if (!prev.includes(file.name)) return [...prev, file.name];
      return prev;
    });

    setRecords(prev => prev.map(r => {
      if (r.id === recId) {
        return { ...r, photoFileName: file.name, isFound: true, photoItem: item };
      }
      return r;
    }));
  };

  // Searchable Photo Picker Controls
  const openPicker = (recId, triggerEl) => {
    const rect = triggerEl.getBoundingClientRect();
    const popoverW = 340;
    const popoverH = 340;

    let left = rect.left;
    if (left + popoverW > window.innerWidth - 12) {
      left = window.innerWidth - popoverW - 12;
    }
    if (left < 10) left = 10;

    let top = rect.bottom + 6;
    if (top + popoverH > window.innerHeight - 10 && rect.top > popoverH) {
      top = rect.top - popoverH - 6;
    }

    setPickerState({
      isOpen: true,
      recordId: recId,
      position: { top: Math.round(top), left: Math.round(left) },
      query: ''
    });

    setTimeout(() => {
      pickerInputRef.current?.focus();
    }, 50);
  };

  const closePicker = () => {
    setPickerState(prev => ({ ...prev, isOpen: false, recordId: null, query: '' }));
  };

  const selectPickerPhoto = (photoName) => {
    const targetRecId = pickerState.recordId || selectedRecord?.id;
    if (targetRecId) {
      setRecords(prev => prev.map(r => {
        if (r.id === targetRecId) {
          const updated = { ...r, photoFileName: photoName };
          return validateRecord(updated, photosMap);
        }
        return r;
      }));
    }
    closePicker();
  };

  // Filtered photos for the picker
  const pickerFilteredPhotos = useMemo(() => {
    const q = (pickerState.query || '').toLowerCase().trim();
    if (!q) return availablePhotosList;
    return availablePhotosList.filter(p => p.toLowerCase().includes(q));
  }, [availablePhotosList, pickerState.query]);

  // Adjust photo positioning / zoom
  const adjustPhotoShiftY = (delta, applyAll = false) => {
    if (applyAll || !selectedRecord) {
      updateCurrentConfig({ photoShiftY: (currentConfig.photoShiftY || 0) + delta });
    } else {
      setRecords(prev => prev.map(r => {
        if (r.id === selectedRecord.id) {
          const cfg = r.config || {};
          return { ...r, config: { ...cfg, photoShiftY: (cfg.photoShiftY || 0) + delta } };
        }
        return r;
      }));
    }
  };

  const adjustPhotoZoom = (delta, applyAll = false) => {
    if (applyAll || !selectedRecord) {
      const newZoom = Math.max(50, Math.min(200, (currentConfig.photoZoom || 100) + delta));
      updateCurrentConfig({ photoZoom: newZoom });
    } else {
      setRecords(prev => prev.map(r => {
        if (r.id === selectedRecord.id) {
          const cfg = r.config || {};
          const newZoom = Math.max(50, Math.min(200, (cfg.photoZoom || 100) + delta));
          return { ...r, config: { ...cfg, photoZoom: newZoom } };
        }
        return r;
      }));
    }
  };

  const setPhotoFitMode = (mode, applyAll = false) => {
    if (applyAll || !selectedRecord) {
      updateCurrentConfig({ photoPosition: mode });
    } else {
      setRecords(prev => prev.map(r => {
        if (r.id === selectedRecord.id) {
          const cfg = r.config || {};
          return { ...r, config: { ...cfg, photoPosition: mode } };
        }
        return r;
      }));
    }
  };

  // Generate Multi-Page PDF
  const handleGeneratePdf = async () => {
    if (categoryRecords.length === 0) {
      alert('Koi record nahi hai generate karne ke liye!');
      return;
    }

    const missingCount = categoryRecords.filter(r => !r.isFound).length;
    if (missingCount > 0) {
      const proceed = confirm(`${missingCount} records me photo missing hai.\n\nKya aap fir bhi PDF generate karna chahte hain?`);
      if (!proceed) return;
    }

    setProgress({ active: true, current: 0, total: categoryRecords.length, percent: 0, message: 'Starting PDF generation in browser...' });

    try {
      const templateImg = templateImgs.get(activeCategory) || templateImgs.get('ALL') || null;

      const loadPhotoFn = async (rec) => {
        if (rec.photoItem && rec.photoItem.url) {
          return new Promise((resolve) => {
            const img = new Image();
            img.src = rec.photoItem.url;
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
          });
        }
        return null;
      };

      const pdfBlob = await generateCardsPdf(
        categoryRecords,
        templateImg,
        loadPhotoFn,
        currentConfig,
        (cur, tot, rec) => {
          setProgress({
            active: true,
            current: cur,
            total: tot,
            percent: Math.round((cur / tot) * 100),
            message: `Rendering ID card for ${rec.name} (${cur}/${tot})...`
          });
        }
      );

      // Download file directly
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Rudaah_Garba_ID_Cards_${activeCategory.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.open(url, '_blank');

      setProgress({ active: false, current: 0, total: 0, percent: 0, message: '' });
      alert(`PDF successfully generated for ${categoryRecords.length} cards!`);
    } catch (err) {
      alert('PDF generation error: ' + err.message);
      setProgress({ active: false, current: 0, total: 0, percent: 0, message: '' });
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0909] text-[#F8F5EE] pb-24">
      
      {/* HEADER */}
      <header className="border-b border-amber-900/40 bg-[#120808]/90 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#992A20] to-[#E6B800] p-0.5 shadow-lg shadow-amber-900/30">
              <div className="w-full h-full bg-[#1A0B0B] rounded-[10px] flex items-center justify-center">
                <Sparkles className="w-5 h-5 text-amber-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-lg font-black font-cinzel tracking-wider text-amber-100">RUDAAH GARBA</h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-[#992A20] text-amber-200 border border-amber-500/30 tracking-widest uppercase">
                  Next.js Studio
                </span>
              </div>
              <p className="text-[11px] text-amber-200/60 font-medium">Category-Wise WhatsApp Chat (.md) + Design + Zip Photo Processor</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                if (confirm('Kya aap category ka saara data reset karna chahte hain?')) {
                  setRecords([]);
                  setPhotosMap(new Map());
                  setAvailablePhotosList([]);
                }
              }}
              className="py-1.5 px-3 rounded-xl bg-[#201010] hover:bg-rose-950/70 border border-rose-800/40 text-rose-300 text-xs font-semibold flex items-center space-x-1.5 transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Data</span>
            </button>
          </div>
        </div>
      </header>

      {/* CATEGORY TABS */}
      <div className="bg-[#140A0A] border-b border-amber-900/30 py-2.5 px-4 sticky top-[69px] z-30 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 overflow-x-auto custom-scroll">
          <div className="flex items-center space-x-2 shrink-0">
            {categories.map(cat => {
              const count = records.filter(r => cat === 'ALL' || r.category === cat).length;
              const isActive = cat === activeCategory;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setActiveCategory(cat);
                    setCurrentPreviewIndex(0);
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold tracking-wide transition flex items-center space-x-2 shrink-0 ${
                    isActive 
                      ? 'bg-gradient-to-r from-[#992A20] to-[#B9352A] text-amber-100 border border-amber-400/50 shadow-lg' 
                      : 'bg-[#180F0F] hover:bg-[#281818] text-amber-200/70 border border-amber-900/30'
                  }`}
                >
                  <Tag className={`w-3.5 h-3.5 ${isActive ? 'text-amber-300' : 'text-amber-400/60'}`} />
                  <span>{cat}</span>
                  <span className={`px-1.5 py-0.2 text-[10px] rounded-full ${isActive ? 'bg-amber-400 text-black font-extrabold' : 'bg-amber-950/60 text-amber-300 border border-amber-700/30'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setAddCatModalOpen(true)}
            className="px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold flex items-center space-x-1 shrink-0"
          >
            <PlusCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>Add Category</span>
          </button>
        </div>
      </div>

      {/* MAIN STUDIO WORKSPACE */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

          {/* LEFT 7 COLS: UPLOADS & VALIDATION TABLE */}
          <div className="lg:col-span-7 space-y-6">

            {/* THREE UPLOAD ZONES */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* WhatsApp Chat Upload */}
              <div 
                onClick={() => fileInputChatRef.current?.click()}
                className="maroon-card p-3.5 rounded-2xl border border-amber-600/30 hover:border-amber-400/70 cursor-pointer transition group shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center space-x-2 text-amber-300 font-bold text-xs mb-1">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                    <span>WhatsApp Chat (.md)</span>
                  </div>
                  <p className="text-[11px] text-amber-200/60">Upload chat export with name & photo info</p>
                </div>
                <div className="mt-3 py-1.5 px-2 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 text-[11px] font-semibold text-center flex items-center justify-center space-x-1">
                  <Upload className="w-3 h-3" />
                  <span>Choose Chat</span>
                </div>
                <input 
                  type="file" 
                  ref={fileInputChatRef} 
                  accept=".md,.txt" 
                  className="hidden" 
                  onChange={handleChatUpload} 
                />
              </div>

              {/* Photos ZIP Upload */}
              <div 
                onClick={() => fileInputZipRef.current?.click()}
                className="maroon-card p-3.5 rounded-2xl border border-amber-600/30 hover:border-amber-400/70 cursor-pointer transition group shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center space-x-2 text-amber-300 font-bold text-xs mb-1">
                    <ImageIcon className="w-4 h-4 text-amber-400" />
                    <span>Photos ZIP (.zip)</span>
                  </div>
                  <p className="text-[11px] text-amber-200/60">
                    {availablePhotosList.length > 0 ? `${availablePhotosList.length} Photos Loaded in Browser` : 'Extracts photos into browser memory'}
                  </p>
                </div>
                <div className="mt-3 py-1.5 px-2 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-500/40 text-[11px] font-semibold text-center flex items-center justify-center space-x-1">
                  <Upload className="w-3 h-3" />
                  <span>Choose ZIP</span>
                </div>
                <input 
                  type="file" 
                  ref={fileInputZipRef} 
                  accept=".zip" 
                  className="hidden" 
                  onChange={handleZipUpload} 
                />
              </div>

              {/* Design Template Upload */}
              <div 
                onClick={() => fileInputTemplateRef.current?.click()}
                className="maroon-card p-3.5 rounded-2xl border border-amber-600/30 hover:border-amber-400/70 cursor-pointer transition group shadow flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center space-x-2 text-amber-300 font-bold text-xs mb-1">
                    <Sliders className="w-4 h-4 text-amber-400" />
                    <span>Design Template</span>
                  </div>
                  <p className="text-[11px] text-amber-200/60">
                    {templateNames.get(activeCategory) || 'Canva Default Theme Active'}
                  </p>
                </div>
                <div className="mt-3 py-1.5 px-2 rounded-lg bg-amber-950/60 text-amber-300 border border-amber-500/40 text-[11px] font-semibold text-center flex items-center justify-center space-x-1">
                  <Upload className="w-3 h-3" />
                  <span>Upload Design</span>
                </div>
                <input 
                  type="file" 
                  ref={fileInputTemplateRef} 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleTemplateUpload} 
                />
              </div>
            </div>

            {/* VALIDATION TABLE */}
            <div className="maroon-card rounded-2xl border border-amber-600/30 shadow-xl overflow-hidden">
              {/* Table Toolbar */}
              <div className="p-3.5 border-b border-amber-900/40 flex flex-wrap items-center justify-between gap-2.5">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-amber-200 flex items-center space-x-2">
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                    <span>Category Records ({categoryRecords.length})</span>
                  </h3>
                  <p className="text-[11px] text-amber-200/60">Edit names/photo filenames inline directly if needed</p>
                </div>

                <div className="flex items-center space-x-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-amber-400/60 absolute left-2.5 top-2" />
                    <input 
                      type="text" 
                      placeholder="Search record..." 
                      value={tableSearch}
                      onChange={(e) => setTableSearch(e.target.value)}
                      className="bg-[#120808] border border-amber-900/60 rounded-lg pl-7 pr-2.5 py-1 text-xs text-amber-200 outline-none focus:border-amber-400" 
                    />
                  </div>

                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="bg-[#120808] border border-amber-900/60 rounded-lg px-2 py-1 text-xs text-amber-200 outline-none"
                  >
                    <option value="ALL">All Status</option>
                    <option value="FOUND">✓ Found Only</option>
                    <option value="MISSING">✗ Missing Only</option>
                  </select>
                </div>
              </div>

              {/* Table Data */}
              <div className="overflow-x-auto max-h-[520px] custom-scroll">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#180B0B] text-amber-300 font-bold uppercase tracking-wider text-[10px] sticky top-0 z-10 border-b border-amber-900/40">
                    <tr>
                      <th className="p-2.5 text-center w-10">#</th>
                      <th className="p-2.5">Name (Editable)</th>
                      <th className="p-2.5">Category</th>
                      <th className="p-2.5">Photo Filename</th>
                      <th className="p-2.5 text-center">Status</th>
                      <th className="p-2.5 text-center w-20">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-950/40">
                    {filteredRecords.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-amber-200/50">
                          Koi record nahi mila. Upar se WhatsApp chat upload karein ya naya record add karein!
                        </td>
                      </tr>
                    ) : (
                      filteredRecords.map((rec, i) => (
                        <tr 
                          key={rec.id}
                          className={`hover:bg-amber-950/20 transition ${!rec.isFound ? 'bg-rose-950/15' : ''}`}
                        >
                          <td className="p-2.5 text-center text-amber-200/60 font-mono">{rec.rowNumber || i + 1}</td>
                          <td className="p-2.5">
                            <input 
                              type="text" 
                              value={rec.name}
                              onChange={(e) => {
                                const val = e.target.value;
                                setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, name: val } : r));
                              }}
                              className="bg-transparent border-b border-transparent hover:border-amber-600 focus:border-amber-400 focus:bg-[#150B0B] text-amber-100 font-bold py-0.5 px-1 rounded w-full outline-none"
                            />
                          </td>
                          <td className="p-2.5">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#992A20]/40 text-amber-200 border border-amber-600/30">
                              {rec.category}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <div className="flex items-center space-x-1.5">
                              <input 
                                type="text" 
                                value={rec.photoFileName || ''}
                                placeholder="Photo name"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setRecords(prev => prev.map(r => {
                                    if (r.id === rec.id) {
                                      return validateRecord({ ...r, photoFileName: val }, photosMap);
                                    }
                                    return r;
                                  }));
                                }}
                                className={`bg-transparent border-b border-transparent hover:border-amber-600 focus:border-amber-400 focus:bg-[#150B0B] font-mono text-xs ${rec.isFound ? 'text-amber-200/90' : 'text-rose-300 font-bold'} py-1 px-1.5 rounded flex-1 outline-none`}
                              />
                              
                              {/* Search Button for Row */}
                              <button
                                type="button"
                                onClick={(e) => openPicker(rec.id, e.currentTarget)}
                                className="bg-[#1C0E0E] hover:bg-[#2F1515] text-amber-200 border border-amber-700/60 hover:border-amber-400 rounded px-2.5 py-1 text-xs outline-none cursor-pointer flex items-center space-x-1 shadow shrink-0 transition"
                                title="Search & pick photo"
                              >
                                <Search className="w-3 h-3 text-amber-400" />
                                <span>Search ▾</span>
                              </button>

                              {/* Camera Upload Button for Row */}
                              <label className="cursor-pointer p-1 bg-[#251212] hover:bg-amber-600/30 text-amber-300 border border-amber-700/60 rounded flex items-center justify-center shrink-0 shadow" title="Upload from PC for this person">
                                <Camera className="w-3.5 h-3.5 text-amber-300" />
                                <input 
                                  type="file" 
                                  accept="image/*" 
                                  className="hidden" 
                                  onChange={(e) => handleSinglePhotoUpload(rec.id, e.target.files?.[0])}
                                />
                              </label>
                            </div>
                          </td>
                          <td className="p-2.5 text-center">
                            {rec.isFound ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40">✓ Found</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-500/40">✗ Missing</span>
                            )}
                          </td>
                          <td className="p-2.5 text-center">
                            <div className="flex items-center justify-center space-x-1">
                              <button 
                                onClick={() => {
                                  const idx = categoryRecords.findIndex(r => r.id === rec.id);
                                  if (idx !== -1) setCurrentPreviewIndex(idx);
                                }}
                                className="p-1 rounded hover:bg-amber-500/20 text-amber-300"
                                title="Preview Card"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => {
                                  if (confirm('Delete this record?')) {
                                    setRecords(prev => prev.filter(r => r.id !== rec.id));
                                  }
                                }}
                                className="p-1 rounded hover:bg-rose-500/20 text-rose-400"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>

          {/* RIGHT 5 COLS: LIVE CARD PREVIEW & ADJUSTMENT STUDIO */}
          <div className="lg:col-span-5 space-y-4">
            
            <div className="maroon-card rounded-2xl p-4 border border-amber-600/30 shadow-2xl space-y-3.5">
              
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-amber-300 flex items-center space-x-1.5">
                  <Eye className="w-4 h-4 text-amber-400" />
                  <span>Live ID Card Preview</span>
                </span>
                <span className="text-xs px-2 py-0.5 bg-[#992A20] text-amber-200 rounded border border-amber-500/30 font-semibold">
                  {selectedRecord?.category || activeCategory}
                </span>
              </div>

              {/* Canvas Preview Container */}
              <div className="flex justify-center bg-[#100A0A] p-3 rounded-xl border border-amber-900/40">
                <div className="relative w-64 rounded-lg overflow-hidden shadow-2xl border border-amber-500/30 maroon-glow-border">
                  <canvas 
                    ref={liveCanvasRef} 
                    className="w-full h-auto object-contain block"
                  />
                </div>
              </div>

              {/* Selected person header & navigation */}
              <div className="flex items-center justify-between text-xs text-amber-200/70">
                <span>Selected: <strong className="text-amber-300">{selectedRecord?.name || 'None'}</strong></span>
                <div className="flex items-center space-x-2">
                  <button 
                    onClick={() => setCurrentPreviewIndex(prev => Math.max(0, prev - 1))}
                    className="text-amber-400 hover:text-amber-300 font-semibold flex items-center space-x-0.5"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Prev</span>
                  </button>
                  <button 
                    onClick={() => setCurrentPreviewIndex(prev => prev + 1)}
                    className="text-amber-400 hover:text-amber-300 font-semibold flex items-center space-x-0.5"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* PHOTO SET & FIT STUDIO */}
              <div className="p-3 bg-[#170E0E] rounded-xl border border-amber-600/40 space-y-3 shadow-lg">
                
                {/* 1. Set / Change Photo Directly */}
                <div className="space-y-1.5 pb-2.5 border-b border-amber-900/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                      <ImageIcon className="w-4 h-4 text-amber-400" />
                      <span>Yaha Se Photo Set Karein:</span>
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                      selectedRecord?.isFound 
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' 
                        : 'bg-rose-950 text-rose-300 border border-rose-500/40'
                    }`}>
                      {selectedRecord?.isFound ? '✓ Photo Found' : '✗ Missing Photo'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Direct PC Upload */}
                    <label className="py-2 px-2.5 bg-gradient-to-r from-amber-700/40 to-amber-600/30 hover:from-amber-600/50 hover:to-amber-500/40 border border-amber-500/60 rounded-lg text-amber-100 text-xs font-bold flex items-center justify-center space-x-1.5 cursor-pointer transition shadow">
                      <Upload className="w-3.5 h-3.5 text-amber-300" />
                      <span>Upload From PC</span>
                      <input 
                        type="file" 
                        ref={singlePhotoFileInputRef}
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          if (selectedRecord) handleSinglePhotoUpload(selectedRecord.id, e.target.files?.[0]);
                        }} 
                      />
                    </label>

                    {/* Search & Pick from Available Photos */}
                    <button 
                      type="button" 
                      onClick={(e) => openPicker(null, e.currentTarget)}
                      className="py-2 px-2 bg-[#251212] hover:bg-[#331818] text-amber-200 border border-amber-700/60 hover:border-amber-400 rounded-lg text-xs font-semibold flex items-center justify-between cursor-pointer shadow truncate transition"
                    >
                      <span className="flex items-center space-x-1.5 truncate">
                        <Search className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="truncate font-mono">
                          {selectedRecord?.photoFileName || 'Search Photo ▾'}
                        </span>
                      </span>
                      <ChevronDown className="w-3 h-3 text-amber-400/80 shrink-0 ml-1" />
                    </button>
                  </div>
                </div>

                {/* 2. Photo Fit (No Cut / Smart Face) */}
                <div className="space-y-1.5 pb-2.5 border-b border-amber-900/50">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300 flex items-center space-x-1.5">
                      <Sliders className="w-3.5 h-3.5 text-amber-400" />
                      <span>Photo Fit Mode:</span>
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-300 font-semibold border border-emerald-600/40">
                      {selectedEffectiveConfig.photoPosition === 'contain' ? 'Pura Photo (No Cut)' : 'Smart Center'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      type="button" 
                      onClick={() => setPhotoFitMode('contain', false)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center space-x-1 transition cursor-pointer shadow border ${
                        selectedEffectiveConfig.photoPosition === 'contain' 
                          ? 'bg-emerald-950 border-emerald-400 text-emerald-200' 
                          : 'bg-[#251212] border-amber-700/50 text-amber-200 hover:border-emerald-500'
                      }`}
                    >
                      <span>🖼️ Pura Photo (100% No Cut)</span>
                    </button>
                    <button 
                      type="button" 
                      onClick={() => setPhotoFitMode('cover', false)}
                      className={`py-1.5 px-2 rounded-lg text-[11px] font-bold flex items-center justify-center space-x-1 transition cursor-pointer shadow border ${
                        selectedEffectiveConfig.photoPosition === 'cover' 
                          ? 'bg-amber-950 border-amber-400 text-amber-200' 
                          : 'bg-[#251212] border-amber-700/50 text-amber-200 hover:border-amber-400'
                      }`}
                    >
                      <span>🎯 Smart Center Focus</span>
                    </button>
                  </div>
                </div>

                {/* 3. Nudge & Zoom Controls */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-amber-300">Nudge & Zoom:</span>
                    <button 
                      type="button" 
                      onClick={() => updateSelectedRecordConfig({ photoShiftY: 0, photoShiftX: 0, photoZoom: 100, photoPosition: 'contain' })}
                      className="px-2 py-0.5 rounded bg-[#221010] hover:bg-rose-900/50 text-amber-300 text-[10px] font-bold border border-amber-900/50 flex items-center space-x-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    <button 
                      type="button" 
                      onClick={() => adjustPhotoShiftY(-25, false)}
                      className="py-1.5 px-1 bg-[#281414] hover:bg-amber-800/40 border border-amber-600/50 rounded-lg text-amber-200 text-[11px] font-bold"
                      title="Photo ko upar karein (Chin dikhane ke liye)"
                    >
                      ⬆️ Upar
                    </button>
                    <button 
                      type="button" 
                      onClick={() => adjustPhotoShiftY(25, false)}
                      className="py-1.5 px-1 bg-[#281414] hover:bg-amber-800/40 border border-amber-600/50 rounded-lg text-amber-200 text-[11px] font-bold"
                      title="Photo ko neeche karein"
                    >
                      ⬇️ Neeche
                    </button>
                    <button 
                      type="button" 
                      onClick={() => adjustPhotoZoom(10, false)}
                      className="py-1.5 px-1 bg-[#281414] hover:bg-amber-800/40 border border-amber-600/50 rounded-lg text-amber-200 text-[11px] font-bold"
                      title="Zoom In"
                    >
                      🔍 Zoom +
                    </button>
                    <button 
                      type="button" 
                      onClick={() => adjustPhotoZoom(-10, false)}
                      className="py-1.5 px-1 bg-[#281414] hover:bg-amber-800/40 border border-amber-600/50 rounded-lg text-amber-200 text-[11px] font-bold"
                      title="Zoom Out"
                    >
                      🔎 Zoom -
                    </button>
                  </div>

                  {/* Real-time Sliders (per-record) */}
                  <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                    <div>
                      <div className="flex justify-between text-amber-200/80 mb-0.5">
                        <span>Shift:</span>
                        <strong className="text-amber-400 font-mono">{selectedEffectiveConfig.photoShiftY || 0}px</strong>
                      </div>
                      <input 
                        type="range" 
                        min="-120" 
                        max="120" 
                        step="5"
                        value={selectedEffectiveConfig.photoShiftY || 0}
                        onChange={(e) => updateSelectedRecordConfig({ photoShiftY: parseInt(e.target.value) })}
                        className="w-full accent-amber-500 cursor-pointer" 
                      />
                    </div>
                    <div>
                      <div className="flex justify-between text-amber-200/80 mb-0.5">
                        <span>Zoom:</span>
                        <strong className="text-amber-400 font-mono">{selectedEffectiveConfig.photoZoom || 100}%</strong>
                      </div>
                      <input 
                        type="range" 
                        min="60" 
                        max="180" 
                        step="5"
                        value={selectedEffectiveConfig.photoZoom || 100}
                        onChange={(e) => updateSelectedRecordConfig({ photoZoom: parseInt(e.target.value) })}
                        className="w-full accent-amber-500 cursor-pointer" 
                      />
                    </div>
                  </div>
                </div>

              </div>

              {/* Adjust Design Drawer */}
              <div className="border-t border-amber-900/40 pt-2">
                <button 
                  onClick={() => setAdjustDrawerOpen(prev => !prev)}
                  className="w-full py-2 px-3 rounded-xl bg-[#190F0F] hover:bg-[#261717] border border-amber-900/40 text-xs text-amber-300 font-bold flex items-center justify-between transition"
                >
                  <span className="flex items-center space-x-2">
                    <Sliders className="w-4 h-4 text-amber-400" />
                    <span>Adjust Photo & Name Position on Your Design</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 transition transform ${adjustDrawerOpen ? 'rotate-180' : ''}`} />
                </button>

                {adjustDrawerOpen && (
                  <div className="mt-3 p-3 bg-[#110A0A] rounded-xl border border-amber-800/40 space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <div className="flex justify-between text-[11px] text-amber-200/80 mb-1">
                          <span>Photo Top (Y):</span>
                          <strong className="text-amber-400 font-mono">{currentConfig.photoY}</strong>
                        </div>
                        <input 
                          type="range" 
                          min="150" 
                          max="1100" 
                          value={currentConfig.photoY}
                          onChange={(e) => updateCurrentConfig({ photoY: parseInt(e.target.value) })}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-amber-200/80 mb-1">
                          <span>Photo Left (X):</span>
                          <strong className="text-amber-400 font-mono">{currentConfig.photoX}</strong>
                        </div>
                        <input 
                          type="range" 
                          min="50" 
                          max="600" 
                          value={currentConfig.photoX}
                          onChange={(e) => updateCurrentConfig({ photoX: parseInt(e.target.value) })}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-amber-200/80 mb-1">
                          <span>Photo Width:</span>
                          <strong className="text-amber-400 font-mono">{currentConfig.photoW}</strong>
                        </div>
                        <input 
                          type="range" 
                          min="150" 
                          max="650" 
                          value={currentConfig.photoW}
                          onChange={(e) => updateCurrentConfig({ photoW: parseInt(e.target.value) })}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-amber-200/80 mb-1">
                          <span>Photo Height:</span>
                          <strong className="text-amber-400 font-mono">{currentConfig.photoH}</strong>
                        </div>
                        <input 
                          type="range" 
                          min="150" 
                          max="650" 
                          value={currentConfig.photoH}
                          onChange={(e) => updateCurrentConfig({ photoH: parseInt(e.target.value) })}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-amber-200/80 mb-1">
                          <span>Name Top (Y):</span>
                          <strong className="text-amber-400 font-mono">{currentConfig.nameY}</strong>
                        </div>
                        <input 
                          type="range" 
                          min="500" 
                          max="1350" 
                          value={currentConfig.nameY}
                          onChange={(e) => updateCurrentConfig({ nameY: parseInt(e.target.value) })}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[11px] text-amber-200/80 mb-1">
                          <span>Name Font Size:</span>
                          <strong className="text-amber-400 font-mono">{currentConfig.nameFontSize}</strong>
                        </div>
                        <input 
                          type="range" 
                          min="20" 
                          max="75" 
                          value={currentConfig.nameFontSize}
                          onChange={(e) => updateCurrentConfig({ nameFontSize: parseInt(e.target.value) })}
                          className="w-full accent-amber-500" 
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Big Primary Generate & Download PDF Button */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleGeneratePdf}
                  className="w-full p-4 bg-gradient-to-r from-rose-950 via-[#2A1212] to-rose-950 hover:border-amber-400 border border-rose-500/50 rounded-xl flex items-center justify-between transition group cursor-pointer shadow-lg"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-lg bg-rose-600/30 border border-rose-500/60 flex items-center justify-center text-rose-300 group-hover:scale-105 transition shrink-0 shadow">
                      <FileDown className="w-5 h-5 text-rose-300" />
                    </div>
                    <div className="text-left">
                      <span className="text-sm font-bold text-amber-100 block">Download &amp; Open PDF</span>
                      <span className="text-[11px] text-amber-200/60">300 DPI High-Resolution Multi-page Badge</span>
                    </div>
                  </div>
                  <div className="px-3 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-xs text-rose-300 font-bold">
                    Generate ({categoryRecords.length})
                  </div>
                </button>
              </div>

            </div>

          </div>

        </div>
      </main>

      {/* SEARCHABLE PHOTO PICKER POPOVER */}
      {pickerState.isOpen && (
        <div 
          style={{ top: `${pickerState.position.top}px`, left: `${pickerState.position.left}px` }}
          className="fixed z-[9999] w-88 max-w-[95vw] bg-[#160B0B] border-2 border-amber-500/80 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden text-xs"
        >
          <div className="p-3 bg-[#221010] border-b border-amber-800/60 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-amber-300 flex items-center space-x-1.5">
                <Search className="w-3.5 h-3.5 text-amber-400" />
                <span>Search Photo:</span>
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950 text-amber-300 border border-amber-600/40 font-mono font-semibold">
                {pickerFilteredPhotos.length} / {availablePhotosList.length} photos
              </span>
            </div>
            
            <div className="relative">
              <Search className="w-4 h-4 text-amber-400/70 absolute left-2.5 top-2.5 pointer-events-none" />
              <input 
                ref={pickerInputRef}
                type="text" 
                value={pickerState.query}
                onChange={(e) => setPickerState(prev => ({ ...prev, query: e.target.value }))}
                placeholder="Filename ya number search karein (e.g. 3685)..." 
                className="w-full bg-[#0E0606] text-amber-100 placeholder-amber-400/40 border border-amber-700/60 focus:border-amber-400 focus:ring-1 focus:ring-amber-500 rounded-lg pl-8 pr-7 py-2 text-xs outline-none font-mono font-medium shadow-inner" 
              />
              {pickerState.query && (
                <button 
                  onClick={() => setPickerState(prev => ({ ...prev, query: '' }))}
                  className="absolute right-2.5 top-2.5 text-amber-400/60 hover:text-amber-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto custom-scroll p-1.5 space-y-1">
            {pickerFilteredPhotos.length === 0 ? (
              <div className="p-6 text-center text-amber-200/50 space-y-1">
                <p className="text-xs">No photos matching &quot;{pickerState.query}&quot;</p>
                <p className="text-[10px] text-amber-400/60">Try searching just numbers (e.g. 3685)</p>
              </div>
            ) : (
              pickerFilteredPhotos.map((photoName) => (
                <div 
                  key={photoName}
                  onClick={() => selectPickerPhoto(photoName)}
                  className="px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition select-none hover:bg-[#251212] text-amber-200/90"
                >
                  <div className="flex items-center space-x-2 truncate pr-2">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-400/70 shrink-0" />
                    <span className="font-mono text-xs truncate">{photoName}</span>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-2.5 bg-[#120707] border-t border-amber-900/60 flex items-center justify-between text-[11px]">
            <button 
              type="button" 
              onClick={() => selectPickerPhoto('')}
              className="text-rose-400 hover:text-rose-300 font-semibold flex items-center space-x-1 py-1 px-2 rounded hover:bg-rose-950/40"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Photo</span>
            </button>
            <button 
              type="button" 
              onClick={closePicker}
              className="text-amber-300 hover:text-amber-100 font-semibold px-2.5 py-1 rounded bg-[#201010] hover:bg-[#2C1616] border border-amber-800/60"
            >
              Close (Esc)
            </button>
          </div>
        </div>
      )}

      {/* ADD CATEGORY MODAL */}
      {addCatModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="maroon-card w-full max-w-md p-6 rounded-2xl border border-amber-500/30 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-amber-200 text-sm uppercase tracking-wider flex items-center space-x-2">
                <PlusCircle className="w-4 h-4 text-amber-400" />
                <span>Add Custom Category</span>
              </h4>
              <button onClick={() => setAddCatModalOpen(false)} className="text-amber-300/60 hover:text-amber-200">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-amber-200/60">Enter category name (e.g. VIP, SECURITY, GUEST, VENDOR):</p>
            <input 
              type="text" 
              value={newCatInput}
              onChange={(e) => setNewCatInput(e.target.value)}
              placeholder="CATEGORY NAME" 
              className="w-full bg-[#120B0B] border border-amber-800/40 rounded-xl p-3 text-xs text-amber-100 uppercase focus:outline-none focus:border-amber-400 font-bold"
            />

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button 
                onClick={() => setAddCatModalOpen(false)} 
                className="px-4 py-2 bg-[#201414] hover:bg-[#2B1B1B] text-amber-200 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  const val = newCatInput.toUpperCase().trim();
                  if (val && !categories.includes(val)) {
                    setCategories(prev => [...prev, val]);
                    setActiveCategory(val);
                    setNewCatInput('');
                    setAddCatModalOpen(false);
                  }
                }}
                className="px-4 py-2 bg-[#992A20] hover:bg-[#BA3428] text-amber-100 rounded-xl text-xs font-bold border border-amber-500/30"
              >
                Add Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PROGRESS MODAL / TOAST */}
      {progress.active && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#160B0B] border-2 border-amber-500/80 rounded-2xl p-4 shadow-2xl w-80 space-y-2 animate-in fade-in">
          <div className="flex justify-between text-xs font-bold text-amber-200">
            <span>Processing...</span>
            <span className="text-amber-400">{progress.percent}%</span>
          </div>
          <div className="w-full bg-black/60 rounded-full h-2 overflow-hidden border border-amber-900/50">
            <div 
              className="bg-gradient-to-r from-amber-500 to-amber-300 h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-[11px] text-amber-200/70 truncate">{progress.message}</p>
        </div>
      )}

    </div>
  );
}
