export type CharacterId = "osric" | "kaelen" | "veyra";

export interface CharacterDef {
  id: CharacterId;
  name: string;
  title: string;
  description: string;
  color: number;
  accent: string;
  modelUrl: string;
  stats: { hp: number; atk: number; spd: number; def: number };
  moveSpeed: number;
  jumpSpeed: number;
}

export const CHARACTERS: CharacterDef[] = [
  {
    id: "osric",
    name: "Osric",
    title: "Kiếm Sĩ Lang Thang",
    description: "Lạnh lùng, bí ẩn. Tay kiếm lão luyện phiêu bạt khắp nơi — không ai biết xuất thân của hắn.",
    color: 0xc24a2a,
    accent: "#ff7a45",
    modelUrl: "/model/model.glb",
    stats: { hp: 90, atk: 85, spd: 55, def: 80 },
    moveSpeed: 4.2,
    jumpSpeed: 6.5,
  },
  {
    id: "kaelen",
    name: "Kaelen",
    title: "Pháp Sư Ánh Sáng",
    description: "Trẻ tuổi nhưng tài năng xuất chúng. Chuyên ma thuật ánh sáng — tấn công từ xa, linh hoạt.",
    color: 0x5b7cff,
    accent: "#7c9bff",
    modelUrl: "/model/model1.glb",
    stats: { hp: 60, atk: 95, spd: 70, def: 40 },
    moveSpeed: 4.8,
    jumpSpeed: 7.5,
  },
  {
    id: "veyra",
    name: "Veyra",
    title: "Nữ Thợ Săn",
    description: "Cung thủ thiện xạ, dao găm sắc bén. Nhanh nhẹn và nguy hiểm — kẻ thù không bao giờ thấy cô trước.",
    color: 0x2dd4a8,
    accent: "#2dd4a8",
    modelUrl: "/model/model2.glb",
    stats: { hp: 70, atk: 80, spd: 95, def: 50 },
    moveSpeed: 6.0,
    jumpSpeed: 8.0,
  },
];

export const getCharacter = (id: CharacterId) =>
  CHARACTERS.find((c) => c.id === id)!;
  