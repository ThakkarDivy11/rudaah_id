# Rudaah Garba ID Card Generator & Studio 🎟️✨

A high-performance batch ID card generator and category-wise production studio built for **Rudaah Garba**. Converts WhatsApp chat exports (`chat.md`) and photos directly into print-ready 300 DPI multi-page PDF badge cards.

---

## 🌟 Key Features

- **Category-Wise Management:** Seamlessly handle different passes (FAMILY, AAA, FOOD COURT, GROUND ACCESS, LABOR, PHOTOGRAPHER, DECOR, BOX OFFICE, CREW, PARKING).
- **WhatsApp Chat Parser:** Automatically extracts member names and photo filenames from `.md` / `.txt` chat logs.
- **Searchable Photo Picker (Instant Combobox):** Type filename or numbers (e.g. `3685`, `WA`) to instantly find and assign photos in real time.
- **Live Preview & Alignment Studio:**
  - `🖼️ Pura Photo (100% No Cut)` - Fits complete image with Canva cream card background.
  - `🎯 Smart Face Center` - Auto-detects and centers human faces using Sharp AI focus.
  - `⬆️ Upar` / `⬇️ Neeche` - Real-time vertical shifting to avoid cutting chins or hair.
  - `🔍 Zoom In` / `🔎 Zoom Out` - Frame zoom controls with per-card or category-wide scope.
  - Custom design positioning sliders (Photo X, Y, W, H, Name Y, Font Size, Color).
- **Direct PC Photo Upload:** Upload photos directly for any specific card or table row from your computer with one click.
- **Print-Ready PDF Export:** Generates 300 DPI high-resolution multi-page PDF badges (3" x 5" standard pass size).
- **Windows Integration:** Automatic PDF file saving to Downloads folder and direct opening in Windows default viewer.

---

## 🚀 Quick Start

### 1. Installation
Clone this repository and install dependencies:
```bash
git clone https://github.com/ThakkarDivy11/rudaah_id.git
cd rudaah_id
npm install
```

### 2. Run Locally
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🛠️ Tech Stack
- **Backend:** Node.js, Express, Sharp (high-performance image processing), pdf-lib (PDF generation).
- **Frontend:** Vanilla JS, Tailwind CSS, Lucide Icons, Cinzel & Outfit typography.
