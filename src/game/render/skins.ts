export type PacHat = "none" | "helmet" | "horns" | "crown" | "leaf" | "shades" | "snorkel";
export type GhostStyle = "classic" | "alien" | "demon" | "spirit" | "jelly" | "pixel";
export type PelletStyle = "dot" | "block" | "star" | "ember" | "seed" | "bubble" | "coin" | "bit";
export type FruitStyle = "coin" | "planet" | "apple" | "flame" | "gem" | "shell" | "chip";
export type Backdrop = "none" | "blockdag" | "grid" | "stars" | "grass" | "embers" | "bubbles" | "sunset" | "code";

export interface Skin {
  id: string;
  name: string;
  description: string;
  /** Price in KAS. 0 = free / always owned. */
  price: number;
  background: number;
  backdrop: Backdrop;
  backdropColor: number;
  wall: number;
  wallGlow: number;
  /** Optional solid color inside the walls. */
  wallFill?: number;
  wallWidth?: number;
  pellet: number;
  pelletStyle: PelletStyle;
  fruitStyle: FruitStyle;
  /** Accessory worn by Kasman. */
  pacHat: PacHat;
  ghosts: [number, number, number, number];
  ghostStyle: GhostStyle;
  fright: number;
  frightFlash: number;
}

const CLASSIC_GHOSTS: Skin["ghosts"] = [0xff4757, 0xff8fd8, 0x3ee8ff, 0xffa23a];

export const SKINS: Skin[] = [
  {
    // Id kept from the old "Kaspa Neon" skin so the equipped setting carries over.
    id: "kaspa-neon",
    name: "Kaspa",
    description: "Default look: Kasman races through the BlockDAG, mining blocks and grabbing KAS coins.",
    price: 0,
    background: 0x07100e,
    backdrop: "blockdag",
    backdropColor: 0x49eacb,
    wall: 0x70c7ba,
    wallGlow: 0x49eacb,
    wallFill: 0x0c2621,
    pellet: 0xbff5e6,
    pelletStyle: "block",
    fruitStyle: "coin",
    pacHat: "none",
    ghosts: CLASSIC_GHOSTS,
    ghostStyle: "classic",
    fright: 0x2e5bff,
    frightFlash: 0xf5f7ff,
  },
  {
    id: "gold-rush",
    name: "Gold Rush",
    description: "A crowned Pac-Man in a vault of gold coins and gems.",
    price: 3,
    background: 0x0d0904,
    backdrop: "stars",
    backdropColor: 0xffd55a,
    wall: 0xf5b700,
    wallGlow: 0xffd55a,
    wallFill: 0x3a2900,
    pellet: 0xffd24a,
    pelletStyle: "coin",
    fruitStyle: "gem",
    pacHat: "crown",
    ghosts: [0xff5a36, 0xff9ecf, 0x6cf0ff, 0xb388ff],
    ghostStyle: "classic",
    fright: 0x5b3cff,
    frightFlash: 0xfff4c2,
  },
  {
    id: "vaporwave",
    name: "Vaporwave",
    description: "Synth sunset, star pellets and very cool shades.",
    price: 3,
    background: 0x13061f,
    backdrop: "sunset",
    backdropColor: 0xff4fd8,
    wall: 0xff4fd8,
    wallGlow: 0x7a5cff,
    pellet: 0x9ff6ff,
    pelletStyle: "star",
    fruitStyle: "gem",
    pacHat: "shades",
    ghosts: [0xff3f7f, 0xffd24f, 0x9d7bff, 0x4fffb0],
    ghostStyle: "classic",
    fright: 0x2b2bff,
    frightFlash: 0xffc6f1,
  },
  {
    id: "space",
    name: "Deep Space",
    description: "Astronaut Pac-Man vs. flying-saucer aliens. Stars to eat, planets to power up.",
    price: 3,
    background: 0x02010a,
    backdrop: "stars",
    backdropColor: 0xffffff,
    wall: 0x8a7dff,
    wallGlow: 0x5b8cff,
    pellet: 0xfff6c8,
    pelletStyle: "star",
    fruitStyle: "planet",
    pacHat: "helmet",
    ghosts: [0x7dff6a, 0xc77dff, 0x5ce1ff, 0xffd166],
    ghostStyle: "alien",
    fright: 0x3a3aff,
    frightFlash: 0xffffff,
  },
  {
    id: "earth",
    name: "Mother Earth",
    description: "Hedge maze, seeds and flowers, forest spirits and apples.",
    price: 3,
    background: 0x0a1408,
    backdrop: "grass",
    backdropColor: 0x6fcf5b,
    wall: 0x7bd35a,
    wallGlow: 0x3fa34d,
    wallFill: 0x1f4d1a,
    wallWidth: 2.5,
    pellet: 0xf3e2a0,
    pelletStyle: "seed",
    fruitStyle: "apple",
    pacHat: "leaf",
    ghosts: [0xe85d3c, 0xf4a6c6, 0x7fd6ff, 0xf2b84b],
    ghostStyle: "spirit",
    fright: 0x5b4bff,
    frightFlash: 0xffffff,
  },
  {
    id: "matrix",
    name: "Matrix",
    description: "Green code rain, pixel ghosts and bits to collect.",
    price: 3,
    background: 0x010801,
    backdrop: "code",
    backdropColor: 0x00ff66,
    wall: 0x00ff66,
    wallGlow: 0x00ff66,
    pellet: 0xb6ffcb,
    pelletStyle: "bit",
    fruitStyle: "chip",
    pacHat: "shades",
    ghosts: [0x00ff66, 0x7dff9b, 0x00c853, 0xc6ff00],
    ghostStyle: "pixel",
    fright: 0x004d1f,
    frightFlash: 0xe8ffe8,
  },
  {
    id: "ocean",
    name: "Deep Ocean",
    description: "Snorkel on. Jellyfish, bubbles, pearls and seashells.",
    price: 3,
    background: 0x031627,
    backdrop: "bubbles",
    backdropColor: 0x7fdcff,
    wall: 0x2ec4d6,
    wallGlow: 0x1a8cff,
    wallFill: 0x0b3a5a,
    pellet: 0xdff9ff,
    pelletStyle: "bubble",
    fruitStyle: "shell",
    pacHat: "snorkel",
    ghosts: [0xff6f91, 0xc39bff, 0x6ff7e8, 0xffb86f],
    ghostStyle: "jelly",
    fright: 0x1b3bff,
    frightFlash: 0xffffff,
  },
  {
    // Id kept from the old "Inferno" skin so existing purchases carry over.
    id: "inferno",
    name: "Hell",
    description: "Lava maze, embers and fireballs. Horned Pac-Man vs. demons.",
    price: 3,
    background: 0x120201,
    backdrop: "embers",
    backdropColor: 0xff6a00,
    wall: 0xff4b1f,
    wallGlow: 0xff9500,
    wallFill: 0x3a0600,
    pellet: 0xffc070,
    pelletStyle: "ember",
    fruitStyle: "flame",
    pacHat: "horns",
    ghosts: [0xff2d2d, 0xff7a1a, 0xb026ff, 0xffd000],
    ghostStyle: "demon",
    fright: 0x2b6cff,
    frightFlash: 0xffffff,
  },
];

export const DEFAULT_SKIN = SKINS[0];
export const getSkin = (id: string) => SKINS.find((s) => s.id === id) ?? DEFAULT_SKIN;
export const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
