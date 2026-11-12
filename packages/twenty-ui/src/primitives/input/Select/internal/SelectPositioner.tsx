import { Select as SelectPrimitive } from '@base-ui/react/select';

import { useProvidedTextDirection } from '@ui/primitives/layout/DirectionProvider/internal/useProvidedTextDirection';
import { mergeClassNames } from '@ui/utilities/internal/mergeClassNames';

import styles from '../Select.module.scss';
import { type SelectPositionerProps } from '../types/SelectPositionerProps';

// CRM-021 (R2): floating-ui's flip() middleware, when its crossAxis alignment
// flip is enabled (the default), mis-detects a collision that does not exist
// once `dir="rtl"` makes an aligned popup grow from its anchor's physical
// right edge instead of its left -- the popup is flipped from "start" to
// "end" with room to spare on every side. "shift" keeps the popup glued to
// the viewport in the genuinely-overflowing case without relabelling the
// alignment, so it is unaffected by that bug.
const SELECT_COLLISION_AVOIDANCE: SelectPositionerProps['collisionAvoidance'] =
  { align: 'shift' };

export const SelectPositioner = ({
  className,
  collisionAvoidance = SELECT_COLLISION_AVOIDANCE,
  ...props
}: SelectPositionerProps) => {
  const direction = useProvidedTextDirection();

  return (
    <SelectPrimitive.Positioner
      dir={direction}
      collisionAvoidance={collisionAvoidance}
      {...props}
      className={mergeClassNames(styles.positioner, className)}
    />
  );
};
