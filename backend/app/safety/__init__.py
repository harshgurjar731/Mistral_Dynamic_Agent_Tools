"""
Tool safety rules — what the AI may not design, request or build as a tool.

Configured on the Settings page. Every rule can be switched on or off, given a
strictness, and pointed at any of the places it can apply (``POINTS``):

* **guidance** points add the rule to a prompt, so the model avoids designing
  or choosing such a tool in the first place;
* **screen** points run a check on a tool or activity request before any code is
  built, and can block the build.

Shipped off: no rule applies anywhere until it is turned on.

    store     rules: CRUD and the built-in seed
    apply     prompt guidance blocks and the build screen's verdict
"""
