# Native Gestalt Live

For this workflow, read [native-session.md](native-session.md) in full.
Use the owning Mobile session’s authenticated native controls; the controller
owns startup, polling, acceptance, Stop and Resume. Do not start a raw helper,
run a second CLI poll loop, invoke an external model, or escalate permissions.
For variants, identify the element, desired direction and count in the native
picker; generate/steer/manual edits arrive through the owning controller.
