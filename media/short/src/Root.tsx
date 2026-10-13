import React from "react";
import { Composition } from "remotion";
import { ClipPoolShort, DURATION, FPS } from "./ClipPoolShort";
import { DEMO_DURATION, FPS as DEMO_FPS, ProductDemo } from "./demo/ProductDemo";
import { Thumbnail } from "./thumbnail/Thumbnail";
import { LogoSquare, Wordmark } from "./brand/Brand";

export const Root: React.FC = () => (
  <>
    <Composition id="ClipPoolShort" component={ClipPoolShort} durationInFrames={DURATION} fps={FPS} width={1080} height={1920} />
    <Composition id="LogoSquare" component={LogoSquare} durationInFrames={1} fps={30} width={1024} height={1024} />
    <Composition id="Wordmark" component={Wordmark} durationInFrames={1} fps={30} width={1600} height={480} />
    <Composition id="WordmarkDark" component={Wordmark} defaultProps={{ dark: true }} durationInFrames={1} fps={30} width={1600} height={480} />
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={30} width={1280} height={720} />
    <Composition id="ProductDemo" component={ProductDemo} durationInFrames={DEMO_DURATION} fps={DEMO_FPS} width={1920} height={1080} />
  </>
);
