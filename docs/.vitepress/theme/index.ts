import { h } from 'vue';
import { useData } from 'vitepress';
import DefaultTheme, { VPImage } from 'vitepress/theme';
import './custom.css';

export default {
  extends: DefaultTheme,
  // the hero image becomes a link if the frontmatter gives `hero.image.link`
  Layout: () => {
    const { frontmatter } = useData();
    const image = frontmatter.value.hero?.image;
    if (!image?.link) return h(DefaultTheme.Layout);
    const { link, ...rest } = image;
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () =>
        h('a', { href: link, target: '_self', title: 'Open the app' },
          h(VPImage, { class: 'image-src', image: rest })),
    });
  },
};
