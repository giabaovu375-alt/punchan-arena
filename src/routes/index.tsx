import { createFileRoute } from "@tanstack/react-router";
import { GameCanvas } from "@/components/GameCanvas";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "3D RPG Game Framework" },
      { name: "description", content: "Khung game 3D nhập vai cơ bản với three.js — điều khiển nhân vật, camera orbit, vật lý đơn giản." },
    ],
  }),
  component: Index,
});

function Index() {
  return <GameCanvas />;
}
