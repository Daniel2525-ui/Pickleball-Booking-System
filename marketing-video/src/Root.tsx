import { Composition } from "remotion";
import { SaasAd, DURATION } from "./SaasAd";

export const Root = () => (
  <>
    {/* Reels / Stories / TikTok */}
    <Composition id="SaasAd" component={SaasAd} durationInFrames={DURATION} fps={30} width={1080} height={1920} />
    {/* Facebook / Instagram feed */}
    <Composition id="SaasAdFeed" component={SaasAd} durationInFrames={DURATION} fps={30} width={1080} height={1350} />
  </>
);
