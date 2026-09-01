export const cueDropBoundary = ({
  cueIndex,
  pointerY,
  top,
  height,
}: Readonly<{
  cueIndex: number;
  pointerY: number;
  top: number;
  height: number;
}>) => (pointerY < top + height / 2 ? cueIndex : cueIndex + 1);

export const cueListEdgeDropBoundary = ({
  pointerY,
  top,
  bottom,
  cueCount,
}: Readonly<{
  pointerY: number;
  top: number;
  bottom: number;
  cueCount: number;
}>) => {
  if (pointerY < top) return 0;
  if (pointerY > bottom) return cueCount;
  return undefined;
};
