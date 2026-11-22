// Bundled fonts (SIL OFL). Rajdhani: Latin + Latin Extended (Croatian diacritics), no Devanagari.
import '@fontsource/rajdhani/latin-400.css';
import '@fontsource/rajdhani/latin-ext-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-ext-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-ext-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/rajdhani/latin-ext-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { BoardingScene } from './scenes/BoardingScene';
import { BootScene } from './scenes/BootScene';
import { FtlScene } from './scenes/FtlScene';
import { MasteryScene } from './scenes/MasteryScene';
import { MenuScene } from './scenes/MenuScene';
import { ResultsScene } from './scenes/ResultsScene';
import { SettingsScene } from './scenes/SettingsScene';
import { StarMapScene } from './scenes/StarMapScene';
import { StationScene } from './scenes/StationScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { COLORS, GAME_HEIGHT, GAME_WIDTH } from './ui/theme';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  backgroundColor: COLORS.bg,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { antialias: true },
  input: { activePointers: 3 },
  scene: [
    BootScene, MenuScene, StarMapScene, StationScene, MasteryScene,
    SettingsScene, FtlScene, BattleScene, UpgradeScene, BoardingScene, ResultsScene,
  ],
};

const game = new Phaser.Game(config);

// Dev-only handle for inspecting the running game from the browser console.
if (import.meta.env.DEV) {
  (window as unknown as { __game: Phaser.Game }).__game = game;
}
