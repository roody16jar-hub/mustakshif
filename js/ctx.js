// Callbacks that app.js provides to screens/forms (avoids circular imports).
export const ctx = {
  goMap: (lat, lon) => {}, openSub: (id) => {}, go: (panel) => {}, refreshMap: () => {}, coverage: () => ({ pct: 0 }), hoodName: (h) => h, locate: async () => null,
};
