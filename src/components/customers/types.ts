export type Slot = {
  date: Date;
  court: string;
  time: string;
  price: number;
  /** At least one hour is charged at a peak rate */
  hasPeak?: boolean;
  duration?: number;
  startSlot?: string;
};
