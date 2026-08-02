#!/usr/bin/env ruby
# Validate distributable plugins and skills against the Codex ingestion contract.

require "json"
require "pathname"
require "uri"
require "yaml"

SEMVER = /\A(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\z/
SKILL_NAME = /\A[a-z0-9]+(?:-[a-z0-9]+)*\z/
PLUGIN_KEYS = %w[id name version description skills apps mcpServers interface author homepage repository license keywords].freeze
INTERFACE_KEYS = %w[displayName shortDescription longDescription developerName category capabilities websiteURL privacyPolicyURL termsOfServiceURL brandColor composerIcon logo logoDark screenshots defaultPrompt default_prompt].freeze
SKILL_KEYS = %w[name description license allowed-tools metadata].freeze

class CodexPackageValidator
  attr_reader :errors

  def initialize
    @errors = []
  end

  def validate(plugin_root)
    root = Pathname(plugin_root).expand_path
    manifest = load_json(root.join(".codex-plugin/plugin.json"), "#{root}: plugin.json")
    return unless manifest

    object(manifest, "#{root}: plugin.json")
    unknown_keys(manifest, PLUGIN_KEYS, "#{root}: plugin.json")
    required_string(manifest, "name", "#{root}: plugin.json")
    version = required_string(manifest, "version", "#{root}: plugin.json")
    error("#{root}: plugin.json version must be strict semver") if version && !SEMVER.match?(version)
    required_string(manifest, "description", "#{root}: plugin.json")
    validate_author(manifest["author"], root)
    validate_interface(manifest["interface"], root)
    validate_contract_path(root, manifest, "skills", "skills")
    validate_contract_path(root, manifest, "apps", ".app.json")
    validate_mcp(root, manifest["mcpServers"])
    validate_skills(root.join("skills")) if root.join("skills").directory?
  end

  private

  def error(message)
    @errors << message
  end

  def load_json(path, label)
    JSON.parse(path.read, create_additions: false)
  rescue Errno::ENOENT
    error("#{label} is missing")
    nil
  rescue JSON::ParserError
    error("#{label} must contain valid JSON")
    nil
  end

  def load_yaml(text, label)
    YAML.safe_load(text, permitted_classes: [], permitted_symbols: [], aliases: false)
  rescue Psych::Exception
    error("#{label} must contain valid YAML")
    nil
  end

  def object(value, label)
    return true if value.is_a?(Hash)

    error("#{label} must be an object")
    false
  end

  def unknown_keys(value, allowed, label)
    return unless value.is_a?(Hash)

    (value.keys - allowed).sort.each do |key|
      error("#{label} field `#{key}` is not accepted by Codex plugin validation")
    end
  end

  def required_string(value, key, label)
    unless value.is_a?(Hash) && value[key].is_a?(String) && !value[key].strip.empty?
      error("#{label} field `#{key}` must be a non-empty string")
      return nil
    end
    value[key]
  end

  def validate_author(author, root)
    label = "#{root}: plugin.json author"
    return unless object(author, label)

    unknown_keys(author, %w[name email url], label)
    required_string(author, "name", label)
    https_url(author["url"], "#{label}.url") if author.key?("url")
  end

  def validate_interface(interface, root)
    label = "#{root}: plugin.json interface"
    return unless object(interface, label)

    unknown_keys(interface, INTERFACE_KEYS, label)
    %w[displayName shortDescription longDescription developerName category].each do |key|
      required_string(interface, key, label)
    end
    capabilities = interface["capabilities"]
    unless capabilities.is_a?(Array) && capabilities.all? { |item| item.is_a?(String) && !item.strip.empty? }
      error("#{label}.capabilities must be an array of non-empty strings")
    end
    prompt = interface["defaultPrompt"] || interface["default_prompt"]
    unless prompt.is_a?(Array) && !prompt.empty? && prompt.length <= 3 &&
           prompt.all? { |item| item.is_a?(String) && !item.strip.empty? && item.length <= 128 }
      error("#{label}.defaultPrompt must contain one to three non-empty strings of at most 128 characters")
    end
    %w[websiteURL privacyPolicyURL termsOfServiceURL].each do |key|
      https_url(interface[key], "#{label}.#{key}") if interface.key?(key)
    end
  end

  def https_url(value, label)
    parsed = URI.parse(value.to_s)
    error("#{label} must be an absolute https URL") unless parsed.is_a?(URI::HTTPS) && parsed.host
  rescue URI::InvalidURIError
    error("#{label} must be an absolute https URL")
  end

  def validate_contract_path(root, manifest, field, expected)
    return unless manifest.key?(field)

    raw = manifest[field]
    normalized = raw.is_a?(String) ? raw.sub(%r{/+\z}, "").sub(%r{\A\./}, "") : nil
    error("#{root}: plugin.json field `#{field}` must resolve to `#{expected}`") unless normalized == expected
    error("#{root}: plugin.json field `#{field}` points to a missing path") unless root.join(expected).exist?
  end

  def validate_mcp(root, value)
    return if value.nil?

    if value.is_a?(String)
      validate_contract_path(root, { "mcpServers" => value }, "mcpServers", ".mcp.json")
      payload = load_json(root.join(".mcp.json"), "#{root}: .mcp.json")
      return unless payload && object(payload, "#{root}: .mcp.json")

      unknown_keys(payload, ["mcpServers"], "#{root}: .mcp.json")
      validate_mcp_entries(payload["mcpServers"], "#{root}: .mcp.json mcpServers")
    elsif value.is_a?(Hash)
      validate_mcp_entries(value, "#{root}: plugin.json mcpServers")
    else
      error("#{root}: plugin.json mcpServers must be a path or object")
    end
  end

  def validate_mcp_entries(entries, label)
    return unless object(entries, label)

    error("#{label} must not be empty") if entries.empty?
    entries.each do |name, config|
      error("#{label} server names must be non-empty strings") unless name.is_a?(String) && !name.strip.empty?
      object(config, "#{label}.#{name}")
    end
  end

  def validate_skills(skills_root)
    skills_root.children.select(&:directory?).sort.each do |skill_root|
      next if skill_root.basename.to_s.start_with?(".")

      validate_skill(skill_root)
    end
  end

  def validate_skill(skill_root)
    label = "skill `#{skill_root.basename}`"
    path = skill_root.join("SKILL.md")
    unless path.file?
      error("#{label} is missing SKILL.md")
      return
    end
    match = path.read.match(/\A---\r?\n(.*?)\r?\n---(?:\r?\n|\z)/m)
    unless match
      error("#{label} must start with closed YAML frontmatter")
      return
    end
    frontmatter = load_yaml(match[1], "#{label} frontmatter")
    return unless object(frontmatter, "#{label} frontmatter")

    unknown_keys(frontmatter, SKILL_KEYS, "#{label} frontmatter")
    name = required_string(frontmatter, "name", "#{label} frontmatter")
    description = required_string(frontmatter, "description", "#{label} frontmatter")
    if name && (!SKILL_NAME.match?(name) || name != skill_root.basename.to_s || name.length > 64)
      error("#{label} frontmatter name must match its directory and use at most 64 lowercase hyphenated characters")
    end
    if description && (description.length > 1024 || description.include?("<") || description.include?(">"))
      error("#{label} description must contain at most 1024 characters and no angle brackets")
    end
    agent_path = skill_root.join("agents/openai.yaml")
    validate_agent_yaml(skill_root, agent_path) if agent_path.file?
  end

  def validate_agent_yaml(skill_root, path)
    label = "skill `#{skill_root.basename}` agents/openai.yaml"
    payload = load_yaml(path.read, label)
    return unless object(payload, label)

    unknown_keys(payload, %w[interface policy dependencies], label)
    interface = payload["interface"]
    return unless object(interface, "#{label} interface")

    unknown_keys(interface, %w[display_name short_description icon_small icon_large brand_color default_prompt], "#{label} interface")
    %w[display_name short_description].each { |key| required_string(interface, key, "#{label} interface") }
    required_string(interface, "default_prompt", "#{label} interface") if interface.key?("default_prompt")
    policy = payload["policy"]
    if policy
      if object(policy, "#{label} policy")
        unknown_keys(policy, ["allow_implicit_invocation"], "#{label} policy")
        value = policy["allow_implicit_invocation"]
        error("#{label} policy.allow_implicit_invocation must be boolean") unless value.nil? || value == true || value == false
      end
    end
  end
end

if ARGV.empty?
  warn "usage: scripts/validate-codex-packages.rb PLUGIN_ROOT..."
  exit 2
end

validator = CodexPackageValidator.new
ARGV.each { |path| validator.validate(path) }
if validator.errors.empty?
  puts "Codex plugin and skill validation passed"
else
  warn "Codex plugin and skill validation failed:"
  validator.errors.each { |message| warn "- #{message}" }
  exit 1
end
