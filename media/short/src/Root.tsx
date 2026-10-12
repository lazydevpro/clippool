import React from "react";
import { Composition } from "remotion";
import { ClipPoolShort, DURATION, FPS } from "./ClipPoolShort";

export const Root: React.FC = () => (
  <Composition id="ClipPoolShort" component={ClipPoolShort} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
);
