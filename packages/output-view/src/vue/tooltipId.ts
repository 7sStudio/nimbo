// Names the viewer's tooltip text with the controller's id: Reka's TooltipTrigger does this for its own tooltip, and
// the viewer's one tooltip has no trigger, its anchors being plain buttons that point at it with aria-describedby.
import { injectTooltipRootContext } from "reka-ui";
import { defineComponent } from "vue";

export const TooltipId = defineComponent({
  name: "TooltipId",
  props: { id: { type: String, required: true } },
  setup(props) {
    const root = injectTooltipRootContext();
    root.contentId ||= props.id;
    return () => null;
  },
});
