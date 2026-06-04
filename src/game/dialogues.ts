/**
 * Lời thoại NPC — chỉnh nội dung ở đây, không cần đụng GameEngine
 */

export interface DialogueDef {
  npcName: string;
  lines: string[];
}

export const INTRO_NPC_DIALOGUE: DialogueDef = {
  npcName: "Người Lạ",
  lines: [
    "Cậu đã sẵn sàng đến thế giới Punchan Arena chưa?",
    "Nơi đó... không dành cho kẻ yếu đuối.",
    "Hãy chứng minh bản thân.",
  ],
};

// Thêm NPC khác ở đây sau này
// export const VILLAGE_ELDER_DIALOGUE: DialogueDef = { ... }
