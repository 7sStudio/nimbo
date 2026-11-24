// The error a subscription ends with when its subscriber's own callback throws (03-api §7.6): a JsnbError whose cause
// is what the callback threw, so the subscriber learns of it through the start promise or onError.
import { JsnbError } from "@jsnb/core";

/** The callbacks a subscription calls with what it receives. */
export type SubscriberCallback = "onState" | "onEvent" | "onGap";

const subscriberFailedMessage = (callback: SubscriberCallback): string =>
  `The subscription's ${callback} callback threw, so the subscription was closed; the cause is what it threw. Fix the callback and subscribe again.`;

export class SubscriberFailed extends JsnbError {
  declare readonly data: { readonly callback: SubscriberCallback };
  constructor(
    data: { readonly callback: SubscriberCallback },
    options: { readonly cause?: unknown } = {},
  ) {
    super({
      name: "SubscriberFailed",
      message: subscriberFailedMessage(data.callback),
      data,
      ...options,
    });
  }
}
