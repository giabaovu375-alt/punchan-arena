/**
 * Game Events - Define all events trong game
 */

export const GameEvents = {
  // Scene events
  SCENE_CHANGE: 'scene:change',
  SCENE_LOADED: 'scene:loaded',
  SCENE_UNLOADED: 'scene:unloaded',
  SCENE_TRANSITION_START: 'scene:transition_start',
  SCENE_TRANSITION_END: 'scene:transition_end',

  // Player events
  PLAYER_SPAWN: 'player:spawn',
  PLAYER_MOVED: 'player:moved',
  PLAYER_JUMPED: 'player:jumped',
  PLAYER_ATTACKED: 'player:attacked',
  PLAYER_DAMAGED: 'player:damaged',
  PLAYER_HEALED: 'player:healed',
  PLAYER_DIED: 'player:died',

  // Enemy events
  ENEMY_SPAWNED: 'enemy:spawned',
  ENEMY_DEFEATED: 'enemy:defeated',
  ENEMY_ATTACKED: 'enemy:attacked',

  // Boss events
  BOSS_SPAWNED: 'boss:spawned',
  BOSS_DEFEATED: 'boss:defeated',
  BOSS_PHASE_CHANGED: 'boss:phase_changed',

  // Portal events
  PORTAL_ENTERED: 'portal:entered',
  PORTAL_EXITED: 'portal:exited',

  // UI events
  UI_DIALOG_OPENED: 'ui:dialog_opened',
  UI_DIALOG_CLOSED: 'ui:dialog_closed',
  UI_MENU_OPENED: 'ui:menu_opened',
  UI_MENU_CLOSED: 'ui:menu_closed',
  UI_HUD_UPDATE: 'ui:hud_update',

  // Quest events
  QUEST_STARTED: 'quest:started',
  QUEST_COMPLETED: 'quest:completed',
  QUEST_FAILED: 'quest:failed',
} as const;

export type GameEvent = typeof GameEvents[keyof typeof GameEvents];
