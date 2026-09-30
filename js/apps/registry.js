// The list of apps OSApp puts in its menu.
//
// The browser cannot enumerate a folder. Nothing learns Calculator.js
// exists unless something imports it by name. This file is that name -
// the one place that knows the full list of launchable apps.
//
// Adding a new app:
//   1. Write js/apps/Foo.js, extending App, with a static displayName.
//   2. Import it below and add it to the APPS array.
//   3. Reload.
//
// Never list App (abstract) or OSApp (can't launch the launcher from
// the launcher).

import { Calculator } from "./Calculator.js";
import { TimeClock }  from "./TimeClock.js";
import { SnakeGame }  from "./SnakeGame.js";
import { Tetris }     from "./Tetris.js";
import { ChatRoom }   from "./ChatRoom.js";
import { Battleship }   from "./Battleship.js";

export const APPS = [
  Calculator,
  TimeClock,
  SnakeGame,
  Tetris,
  ChatRoom,
  Battleship,
];