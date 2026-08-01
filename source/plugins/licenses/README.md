<!--header-->
<table>
  <tr><td colspan="2"><a href="/README.md#-plugins">← Back to plugins index</a></td></tr>
  <tr><th colspan="2"><h3>📜 Repository licenses</h3></th></tr>
  <tr><td colspan="2" align="center"><p>This plugin display repository license information like permissions, limitations and conditions along with additional stats about dependencies.</p>
</td></tr>
  <tr><th>⚠️ Disclaimer</th><td><p>This plugin is not affiliated, associated, authorized, endorsed by, or in any way officially connected with <a href="https://github.com">GitHub</a>.
All product and company names are trademarks™ or registered® trademarks of their respective holders.</p>
</td></tr>
  <tr><th>ℹ Additional notes</th><td><blockquote>
<p>⚠️ This is <strong>NOT</strong> legal advice, use at your own risk</p>
</blockquote>
<blockquote>
<p>💣 This plugin <strong>SHOULD NOT</strong> be enabled on web instances, since it allows raw command injection.
This could result in compromised server!</p>
</blockquote>
</td></tr>
  <tr>
    <th rowspan="3">Supported features<br><sub><a href="metadata.yml">→ Full specification</a></sub></th>
    <td><a href="/source/templates/repository/README.md"><code>📘 Repository template</code></a></td>
  </tr>
  <tr>
    <td><code>📓 Repositories</code></td>
  </tr>
  <tr>
    <td><code>🔑 (scopeless)</code> <code>read:org (optional)</code> <code>read:user (optional)</code> <code>read:packages (optional)</code> <code>repo (optional)</code></td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <details open><summary>Permissions, limitations and conditions</summary><img src="https://github.com/gh-metrics/metrics/blob/examples/metrics.plugin.licenses.svg" alt=""></img></details>
      <details open><summary>Licenses overview</summary><img src="https://github.com/gh-metrics/metrics/blob/examples/metrics.plugin.licenses.ratio.svg" alt=""></img></details>
      <img width="900" height="1" alt="">
    </td>
  </tr>
</table>
<!--/header-->

## 🔎 Licenses analysis

Use to `plugin_licenses_setup` command to setup project dependencies.

*Example: setup a NodeJS project using `npm ci --ignore-scripts`*
```yml
- name: Licenses and permissions
  with:
    repo: metrics
    plugin_licenses: yes
    plugin_licenses_setup: npm ci --ignore-scripts
```

Dependencies will be analyzed by [GitHub licensed](https://github.com/github/licensed) and compared against GitHub known licenses.

> ⚠️ This is **NOT** legal advice, use at your own risk

> 💣 This plugin **SHOULD NOT** be enabled on web instances, since it allows raw command injection.
> This could result in compromised server!


## ➡️ Available options

<!--options-->
<table>
  <tr>
    <td align="center" nowrap="nowrap">Option</i></td><td align="center" nowrap="nowrap">Description</td>
  </tr>
  <tr>
    <td nowrap="nowrap"><h4><code>plugin_licenses</code></h4></td>
    <td rowspan="2"><p>Enable licenses plugin</p>
<img width="900" height="1" alt=""></td>
  </tr>
  <tr>
    <td nowrap="nowrap">✨ On <code>master</code>/<code>main</code><br>
🌐 Web instances must configure <code>settings.json</code>:
<ul>
<li><i>metrics.cpu.overuse</i></li>
<li><i>metrics.run.tempdir</i></li>
<li><i>metrics.run.git</i></li>
<li><i>metrics.run.licensed</i></li>
<li><i>metrics.run.user.cmd</i></li>
</ul>
<b>type:</b> <code>boolean</code>
<br>
<b>default:</b> no<br></td>
  </tr>
  <tr>
    <td nowrap="nowrap"><h4><code>plugin_licenses_setup</code></h4></td>
    <td rowspan="2"><p>Setup command</p>
<blockquote>
<p>ℹ️ Depending on the project, this may not be required.
The example command is intended for NodeJs projects that use <code>npm</code> to install their dependencies.</p>
</blockquote>
<img width="900" height="1" alt=""></td>
  </tr>
  <tr>
    <td nowrap="nowrap">✨ On <code>master</code>/<code>main</code><br>
<b>type:</b> <code>string</code>
<br></td>
  </tr>
  <tr>
    <td nowrap="nowrap"><h4><code>plugin_licenses_ratio</code></h4></td>
    <td rowspan="2"><p>Used licenses ratio</p>
<img width="900" height="1" alt=""></td>
  </tr>
  <tr>
    <td nowrap="nowrap">✨ On <code>master</code>/<code>main</code><br>
<b>type:</b> <code>boolean</code>
<br>
<b>default:</b> no<br></td>
  </tr>
  <tr>
    <td nowrap="nowrap"><h4><code>plugin_licenses_legal</code></h4></td>
    <td rowspan="2"><p>Permissions, limitations and conditions about used licenses</p>
<img width="900" height="1" alt=""></td>
  </tr>
  <tr>
    <td nowrap="nowrap">✨ On <code>master</code>/<code>main</code><br>
<b>type:</b> <code>boolean</code>
<br>
<b>default:</b> yes<br></td>
  </tr>
</table>
<!--/options-->

## ℹ️ Examples workflows

<!--examples-->
```yaml
name: Licenses and permissions
with:
  filename: metrics.plugin.licenses.svg
  token: ${{ secrets.METRICS_TOKEN }}
  base: ""
  template: repository
  repo: metrics
  plugin_licenses: yes
  plugin_licenses_setup: bash -c '[[ -f package.json ]] && npm ci --ignore-scripts || true'

```
```yaml
name: Licenses with open-source ratio graphs
uses: gh-metrics/metrics@latest
with:
  filename: metrics.plugin.licenses.ratio.svg
  token: ${{ secrets.METRICS_TOKEN }}
  base: ""
  template: repository
  repo: metrics
  plugin_licenses: yes
  plugin_licenses_setup: bash -c '[[ -f package.json ]] && npm ci --ignore-scripts || true'
  plugin_licenses_legal: no
  plugin_licenses_ratio: yes

```
<!--/examples-->
