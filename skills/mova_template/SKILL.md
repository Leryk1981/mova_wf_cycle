# skill.mova_template – baseline MOVA skill example

This skill is not tied to a specific domain (files, Obsidian, etc.).

It demonstrates the structure of a MOVA skill with a simple example:

> Take a short procedure description and convert it into a structured list of steps.

## What the skill does

- Input: a brief process description (one or a few paragraphs).
- Output: a structured list of steps with titles and descriptions.

Example:

> “Brew a morning coffee in a cezve”

is converted into a list like:

1. Prepare the cezve and coffee.
2. Pour water.
3. Add coffee.
4. Heat until foam rises.
5. Remove from heat and serve.

This skill serves as a template for:

- how a `skills/<id>/` folder is organized,
- where the manifest lives,
- where local `ds.` / `env.` schemas are,
- where examples (`cases/`) and episodes (`episodes/`) go,
- where implementation (`impl/`) resides.
