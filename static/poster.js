/* 年度海报绘制：只负责 Canvas 排版，不依赖应用状态。 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const initialOf = (title) => Array.from(String(title || "").trim())[0] || "?";
  const safeAccent = (value) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#8b5cf6";
  let notify = () => {};

  function toast(message, type, duration) {
    notify(message, type, duration);
  }

  function drawRoundRect(ctx, x, y, width, height, radius, fill, stroke = null) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 4; ctx.stroke(); }
  }

  function drawWrapped(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
    const chars = Array.from(String(text));
    let line = "";
    let lines = 0;
    for (const char of chars) {
      const test = line + char;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y + lines * lineHeight);
        lines += 1;
        line = char;
        if (lines >= maxLines) return;
      } else {
        line = test;
      }
    }
    if (line && lines < maxLines) ctx.fillText(line, x, y + lines * lineHeight);
  }

  function loadPosterImage(item) {
    if (!item || !item.coverUrl) return Promise.resolve(null);
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = item.coverUrl;
    });
  }

  function posterImage(ctx, image, x, y, width, height) {
    if (!image || !image.width || !image.height) return false;
    const scale = Math.max(width / image.width, height / image.height);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    ctx.drawImage(
      image,
      (image.width - sourceWidth) / 2,
      (image.height - sourceHeight) / 2,
      sourceWidth,
      sourceHeight,
      x, y, width, height,
    );
    return true;
  }

  function posterPath(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function posterStar(ctx, x, y, radius, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const r = index % 2 === 0 ? radius : radius * 0.42;
      const px = Math.cos(angle) * r;
      const py = Math.sin(angle) * r;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#241d2f";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function posterTape(ctx, x, y, width, rotation = -3) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.fillStyle = "#ffd84d";
    ctx.fillRect(-width / 2, -10, width, 20);
    ctx.strokeStyle = "rgba(36,29,47,.35)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-width / 2, -10, width, 20);
    ctx.restore();
  }

  function posterCoverCard(ctx, item, image, x, y, width, height, rotation, index) {
    const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
    ctx.save();
    ctx.translate(x + width / 2, y + height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.shadowColor = "rgba(0,0,0,.22)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 10;
    ctx.fillStyle = "#fffaf0";
    posterPath(ctx, -width / 2, -height / 2, width, height, 10);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#241d2f";
    ctx.lineWidth = 3;
    posterPath(ctx, -width / 2, -height / 2, width, height, 10);
    ctx.stroke();

    const pad = 9;
    const imageX = -width / 2 + pad;
    const imageY = -height / 2 + pad;
    const imageWidth = width - pad * 2;
    const imageHeight = height - pad * 2;
    ctx.save();
    posterPath(ctx, imageX, imageY, imageWidth, imageHeight, 6);
    ctx.clip();
    if (!posterImage(ctx, image, imageX, imageY, imageWidth, imageHeight)) {
      const accent = safeAccent(item.accent);
      const gradient = ctx.createLinearGradient(imageX, imageY, imageX + imageWidth, imageY + imageHeight);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, "#fff7e8");
      ctx.fillStyle = gradient;
      ctx.fillRect(imageX, imageY, imageWidth, imageHeight);
      ctx.fillStyle = "rgba(36,29,47,.82)";
      ctx.font = `900 82px ${font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initialOf(item.title), 0, -8);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
    }
    ctx.restore();

    posterTape(ctx, 0, -height / 2 + 1, 58, index % 2 ? 3 : -4);
    ctx.restore();
  }

  async function downloadYearPoster(data) {
    const button = $("#yearPosterBtn");
    if (button) button.disabled = true;
    toast("正在生成年度海报…");
    try {
      const images = await Promise.all(data.topWorks.slice(0, 4).map(loadPosterImage));
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1440;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const font = '"Microsoft YaHei", "PingFang SC", sans-serif';
      const ink = "#241d2f";
      const accent = safeAccent(data.topWorks[0] && data.topWorks[0].accent || "#ff5d9e");

      ctx.fillStyle = "#fff7e8";
      ctx.fillRect(0, 0, 1080, 1440);
      ctx.fillStyle = "rgba(36,29,47,.055)";
      for (let y = 70; y < 1400; y += 34) {
        for (let x = 52; x < 1040; x += 34) {
          ctx.beginPath();
          ctx.arc(x, y, 1.35, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.strokeStyle = ink;
      ctx.lineWidth = 7;
      ctx.strokeRect(26, 26, 1028, 1388);
      ctx.fillStyle = "#ff5d9e";
      ctx.fillRect(26, 26, 1028, 17);
      ctx.fillStyle = "#ffd84d";
      ctx.fillRect(76, 76, 188, 23);
      ctx.fillStyle = ink;
      ctx.font = `900 22px ${font}`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("YEAR IN REVIEW / 我的动漫年度总结", 76, 126);

      ctx.font = `900 176px ${font}`;
      ctx.fillText(String(data.year), 68, 168);
      ctx.font = `900 34px ${font}`;
      ctx.fillText("看过的故事，都算数。", 76, 365);
      ctx.fillStyle = "#6d6479";
      ctx.font = `700 17px ${font}`;
      ctx.fillText(`${data.items.length} 部作品 · ${data.episodes} 集 · 平均 ${data.average} 分`, 76, 411);

      posterStar(ctx, 540, 226, 18, "#ffd84d");
      posterStar(ctx, 560, 278, 9, "#ff8fb8");
      posterStar(ctx, 1004, 330, 15, "#b79bff");

      const stats = [
        ["部作品", data.items.length, "#ffe3ed"],
        ["集动画", data.episodes, "#e9f8f0"],
        ["平均分", data.average, "#fff3bd"],
        ["最高分", data.highest || "—", "#f0eaff"],
      ];
      stats.forEach(([label, value, color], index) => {
        const x = 76 + (index % 2) * 224;
        const y = 455 + Math.floor(index / 2) * 116;
        drawRoundRect(ctx, x, y, 210, 100, 13, color, ink);
        ctx.fillStyle = ink;
        ctx.font = `900 43px ${font}`;
        ctx.fillText(String(value), x + 19, y + 22);
        ctx.fillStyle = "#6d6479";
        ctx.font = `700 16px ${font}`;
        ctx.fillText(label, x + 19, y + 74);
      });

      const cardPositions = [
        [598, 276, -4], [806, 294, 3], [608, 552, 3], [816, 570, -3],
      ];
      data.topWorks.slice(0, 4).forEach((item, index) => {
        const position = cardPositions[index];
        posterCoverCard(ctx, item, images[index], position[0], position[1], 218, 270, position[2], index);
      });
      if (data.topWorks.length < 4) {
        posterTape(ctx, 700, 285, 90, -2);
      }

      ctx.fillStyle = ink;
      ctx.font = `900 27px ${font}`;
      ctx.fillText("年度关键词", 76, 710);
      const tagColors = ["#ffe3ed", "#e9f8f0", "#fff3bd", "#f0eaff", "#e4f6ff"];
      let tagX = 76;
      let tagY = 754;
      data.topTags.slice(0, 6).forEach(([tag, count], index) => {
        const label = `${tag} ${count}`;
        ctx.font = `700 18px ${font}`;
        const width = ctx.measureText(label).width + 24;
        if (tagX + width > 520) {
          tagX = 76;
          tagY += 38;
        }
        drawRoundRect(ctx, tagX, tagY, width, 30, 6, tagColors[index % tagColors.length], "rgba(36,29,47,.2)");
        ctx.fillStyle = ink;
        ctx.font = `700 18px ${font}`;
        ctx.fillText(label, tagX + 12, tagY + 7);
        tagX += width + 8;
      });
      if (!data.topTags.length) {
        ctx.fillStyle = "#6d6479";
        ctx.font = `700 19px ${font}`;
        ctx.fillText("这一年还没有记录标签", 76, 764);
      }

      drawRoundRect(ctx, 76, 884, 928, 286, 16, "#fffaf0", "rgba(36,29,47,.35)");
      ctx.fillStyle = "#e94f8a";
      ctx.font = `900 13px ${font}`;
      ctx.fillText("HIGHLIGHTS", 100, 904);
      ctx.fillStyle = ink;
      ctx.font = `900 28px ${font}`;
      ctx.fillText("年度高分", 100, 930);
      data.topWorks.slice(0, 4).forEach((item, index) => {
        const y = 986 + index * 46;
        ctx.fillStyle = "#e94f8a";
        ctx.font = `900 20px ${font}`;
        ctx.fillText(`0${index + 1}`, 102, y);
        ctx.fillStyle = ink;
        ctx.font = `800 24px ${font}`;
        drawWrapped(ctx, item.title, 150, y - 2, 650, 28, 1);
        ctx.fillStyle = "#e94f8a";
        ctx.font = `800 20px ${font}`;
        ctx.textAlign = "right";
        ctx.fillText(item.rating ? `${item.rating} / 5` : "未评分", 978, y);
        ctx.textAlign = "left";
      });

      ctx.fillStyle = ink;
      ctx.fillRect(26, 1212, 1028, 202);
      ctx.fillStyle = accent;
      ctx.fillRect(26, 1212, 1028, 7);
      ctx.fillStyle = "#fff9ef";
      ctx.font = `900 34px ${font}`;
      ctx.fillText("番迹", 76, 1252);
      ctx.fillStyle = "rgba(255,249,239,.58)";
      ctx.font = `700 14px ${font}`;
      ctx.fillText("FANJI / ANIME ARCHIVE", 76, 1300);
      ctx.fillStyle = "#fff9ef";
      ctx.font = `700 24px ${font}`;
      ctx.fillText("把看过的故事，留在这里。", 76, 1348);
      ctx.fillStyle = "rgba(255,249,239,.55)";
      ctx.font = `700 13px ${font}`;
      ctx.fillText(`MY ANIME YEAR · ${data.year}`, 76, 1382);
      ctx.textAlign = "right";
      ctx.fillStyle = "#ffd84d";
      ctx.font = `900 30px ${font}`;
      ctx.fillText(String(data.year), 1000, 1330);
      ctx.textAlign = "left";

      canvas.toBlob((blob) => {
        if (!blob) {
          toast("海报生成失败，请稍后再试", "error");
          return;
        }
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `fanji-year-${data.year}.png`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1200);
        toast("年度海报已生成");
      }, "image/png");
    } catch {
      toast("海报生成失败，请稍后再试", "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  window.FanjiPoster = {
    download(data, options = {}) {
      notify = typeof options.toast === "function" ? options.toast : () => {};
      return downloadYearPoster(data);
    },
  };
})();
