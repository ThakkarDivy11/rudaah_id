const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Exact coordinates derived from Family.pdf at 300 DPI (900 x 1500 px)
// Canvas dimensions: 900 x 1500 px (equivalent to 216 x 360 pt at 300 DPI)
const TEMPLATE_CONFIG = {
  width: 900,
  height: 1500,
  creamColor: '#FEF4DB',
  maroonColor: '#992A20',
  photoBox: {
    x: 265,
    y: 537,
    width: 371,
    height: 415
  },
  nameBox: {
    y: 1045,
    height: 60,
    fontSize: 48,
    color: '#992A20'
  },
  categoryBox: {
    y: 1365,
    height: 70,
    fontSize: 66,
    color: '#FEF4DB'
  }
};

module.exports = {
  TEMPLATE_CONFIG
};
