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
