/**
 * A person's avatar (GAP-045): the one primitive the hero, the directory, the
 * people palette, and Quick capture draw a person with.
 *
 * It is Base UI's avatar: the image is loaded first and shown only once it
 * has loaded, so an image that is missing, quarantined, or otherwise refused
 * leaves the initials in place instead of a broken picture. The initials are
 * the caller's — they follow the name the member reads — and the colour is
 * the server's descriptor, with ink chosen for contrast. The avatar is
 * decoration beside a visible name, so it is hidden from assistive
 * technology and its image carries an empty `alt`.
 */

import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import {
  avatarImageVariants,
  type AvatarVariantProps,
  avatarVariants,
} from "./variants.ts";

/** How a person is drawn, as the API describes it. */
export interface AvatarDescriptor {
  readonly color: string;
  readonly imageUrl?: string | undefined;
}

const DARK_INK = "#111111";
const LIGHT_INK = "#ffffff";

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/** The ink, dark or light, that reads best on a `#rrggbb` colour. */
export function readableInk(color: string): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) return LIGHT_INK;
  const [red, green, blue] = match.slice(1).map((hex) => parseInt(hex, 16));
  const luminance = 0.2126 * channel(red!) + 0.7152 * channel(green!) +
    0.0722 * channel(blue!);
  const onLight = 1.05 / (luminance + 0.05);
  const onDark = (luminance + 0.05) / (0.0056 + 0.05);
  return onDark > onLight ? DARK_INK : LIGHT_INK;
}

export interface AvatarProps extends AvatarVariantProps {
  readonly avatar?: AvatarDescriptor | undefined;
  readonly className?: string;
  readonly id?: string;
  /** What the avatar shows until, or instead of, the image. */
  readonly initials: string;
}

export function Avatar(
  { avatar, className, id, initials, size }: AvatarProps,
) {
  return (
    <AvatarPrimitive.Root
      aria-hidden="true"
      className={avatarVariants({
        size,
        ...(className ? { className } : {}),
      })}
      data-slot="avatar"
      {...(id ? { id } : {})}
      {...(avatar
        ? {
          style: {
            backgroundColor: avatar.color,
            color: readableInk(avatar.color),
          },
        }
        : {})}
    >
      {avatar?.imageUrl
        ? (
          <AvatarPrimitive.Image
            alt=""
            className={avatarImageVariants}
            src={avatar.imageUrl}
          />
        )
        : null}
      <AvatarPrimitive.Fallback>{initials}</AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
