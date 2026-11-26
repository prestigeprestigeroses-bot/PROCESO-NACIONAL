const colorGroups = [
  ['ROJOS', ['FREEDOM', 'EXPLORER']],
  ['BLANCOS', ['VENDELA', 'MONDIAL', 'CANDLELIGHT', 'WHITE OHARA']],
  ['ROSADOS CLAROS', ['PINK MONDIAL', 'BLESSING', 'PINK OHARA', 'SUMMERSAND', 'SOMMERSAND']],
  ['ROSADOS MEDIOS', ['SWAN']],
  ['ROSADOS FUERTES', ['PINK FLOYD', 'QUEEN BERRY']],
  ['AMARILLOS', ['MOMENTUM', 'YELLOW BIKINI', 'HUMMER']],
  ['MORADOS', ['STAR PLATINUM', 'DEEP PURPLE', 'MOODY BLUE', 'MOODY BLUES']],
  ['NARANJAS', ['HILUX', 'CORAL REEF']],
  ['PEACH', ['TIFFANY', 'SHIMMER']],
  ['ARENA', ['QUICK SAND', 'QUICKSAND']]
];
const normalizeVariety = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const colorOf = new Map(colorGroups.flatMap(([color, varieties]) => varieties.map(variety => [normalizeVariety(variety), color])));

module.exports = { colorGroups, colorOf, normalizeVariety };
