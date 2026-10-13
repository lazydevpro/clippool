import React from "react";
import { Composition } from "remotion";
import { ClipPoolShort, DURATION, FPS } from "./ClipPoolShort";
import { DEMO_DURATION, FPS as DEMO_FPS, ProductDemo } from "./demo/ProductDemo";
import { Thumbnail } from "./thumbnail/Thumbnail";

export const Root: React.FC = () => (
  <>
    <Composition id="ClipPoolShort" component={ClipPoolShort} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={30} width={1280} height={720} />
    <Composition id="ProductDemo" component={ProductDemo} durationInFrames={DEMO_DURATION} fps={DEMO_FPS} width={1920} height={1080} />
  </>
);
